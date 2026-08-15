import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { DbService } from "../infra/db.service";

interface PushMessage {
  to: string;
  /** Omitted for data-only messages (the app renders its own alarm). */
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: string;
  /** Expo: "high" wakes the device for time-critical alerts. */
  priority?: "default" | "normal" | "high";
  /** Android notification channel the push is delivered on. */
  channelId?: string;
}

/**
 * Guests aren't on the roster — they type a name that gets slugged into their
 * userId (`external_ivan_petrov`, `runner_ivan_petrov_42`). Read it back out.
 */
function nameFromUserIdSlug(userId: string): string | null {
  const slug = /^(?:external|runner)_(.+)$/.exec(userId)?.[1];
  if (!slug) return null;
  const pretty = slug
    .replace(/_\d+$/, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return pretty || null;
}

/** One registered device, as shown on the dashboard's Devices page. */
export interface PushSubscription {
  id: string;
  userId: string;
  /** Roster name this device last joined under, when it can be resolved. */
  userName: string | null;
  eventId: string;
  platform: string;
  deviceId: string | null;
  /** Last 8 chars only — enough to tell two devices apart, not enough to push. */
  tokenPreview: string;
  updatedAt: string;
}

interface PushOptions {
  channelId?: string;
  /**
   * Send as a data-only message: no system-rendered notification. The app's
   * background push task receives it (even killed) and raises a full notifee
   * alarm — looping sound, strong vibration — which the OS can't do for a
   * plain notification push.
   */
  dataOnly?: boolean;
  /**
   * Skip this user's devices — so the medic who reported an incident isn't
   * alarmed by their own report.
   */
  excludeUserId?: string;
}

function buildMessage(token: string, title: string, body: string, data: Record<string, unknown> | undefined, opts?: PushOptions): PushMessage {
  if (opts?.dataOnly) {
    return { to: token, data: { ...data, title, body }, priority: "high" };
  }
  return { to: token, title, body, data, sound: "default", priority: "high", channelId: opts?.channelId };
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly expoUrl = "https://exp.host/--/api/v2/push/send";

  constructor(private readonly db: DbService) {}

  async onModuleInit() {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        id         BIGSERIAL PRIMARY KEY,
        user_id    TEXT NOT NULL,
        event_id   TEXT NOT NULL,
        token      TEXT NOT NULL,
        platform   TEXT NOT NULL DEFAULT 'expo',
        device_id  TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_push_tokens_event ON push_tokens (event_id)
    `);
    // Display name captured when the device registered, so the dashboard can
    // show "Ivan's phone" instead of a bare medic uuid.
    await this.db.query(`ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS user_name TEXT`);

    // A device belongs to exactly ONE event: the last one it joined. The table
    // used to key on (user_id, event_id, token), so every event a device ever
    // joined left a row behind and old events kept alarming phones that had
    // long since moved on. Collapse to one row per token — newest wins — and
    // let the unique index keep it that way.
    await this.db.query(`ALTER TABLE push_tokens DROP CONSTRAINT IF EXISTS push_tokens_user_id_event_id_token_key`);
    const { rowCount } = await this.db.query(
      `DELETE FROM push_tokens a
        USING push_tokens b
        WHERE a.token = b.token
          AND (a.updated_at < b.updated_at OR (a.updated_at = b.updated_at AND a.id < b.id))`,
    );
    if (rowCount) {
      this.logger.log(`Pruned ${rowCount} stale push subscription(s) from previously joined events`);
    }
    await this.db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_token ON push_tokens (token)`);
  }

  /**
   * Best-effort display name for a session userId. Rostered medics carry their
   * event_medics.id as the userId; guests encode their typed name in the slug.
   */
  private async resolveUserName(userId: string, eventId: string): Promise<string | null> {
    const { rows } = await this.db.query<{ name: string }>(
      `SELECT name FROM event_medics WHERE id::text = $1 AND event_id = $2`,
      [userId, eventId],
    );
    return rows[0]?.name ?? nameFromUserIdSlug(userId);
  }

  async registerToken(
    userId: string,
    eventId: string,
    token: string,
    platform = "expo",
    deviceId?: string,
  ): Promise<void> {
    const userName = await this.resolveUserName(userId, eventId);
    // Conflict is on the token alone: re-registering MOVES the device to the
    // event it just joined rather than adding a second subscription.
    await this.db.query(
      `INSERT INTO push_tokens (user_id, event_id, token, platform, device_id, user_name, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (token) DO UPDATE
         SET user_id    = EXCLUDED.user_id,
             event_id   = EXCLUDED.event_id,
             platform   = EXCLUDED.platform,
             device_id  = EXCLUDED.device_id,
             user_name  = COALESCE(EXCLUDED.user_name, push_tokens.user_name),
             updated_at = now()`,
      [userId, eventId, token, platform, deviceId ?? null, userName],
    );
  }

  /** Every device currently registered for pushes, newest first. */
  async listSubscriptions(eventId?: string): Promise<PushSubscription[]> {
    const { rows } = await this.db.query<{
      id: string;
      user_id: string;
      user_name: string | null;
      event_id: string;
      platform: string;
      device_id: string | null;
      token: string;
      updated_at: Date;
    }>(
      // Prefer the name captured at registration; fall back to the live roster
      // so devices registered before that column existed still show a name.
      `SELECT p.id::text AS id, p.user_id, COALESCE(p.user_name, em.name) AS user_name,
              p.event_id, p.platform, p.device_id, p.token, p.updated_at
         FROM push_tokens p
         LEFT JOIN event_medics em ON em.id::text = p.user_id AND em.event_id = p.event_id
        ${eventId ? "WHERE p.event_id = $1" : ""}
        ORDER BY p.updated_at DESC`,
      eventId ? [eventId] : [],
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name ?? nameFromUserIdSlug(r.user_id),
      eventId: r.event_id,
      platform: r.platform,
      deviceId: r.device_id,
      tokenPreview: r.token.replace(/\]$/, "").slice(-8),
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  /** Unsubscribe one device. It re-registers only when that phone reopens the app. */
  async deleteSubscription(id: string): Promise<{ deleted: number }> {
    const { rowCount } = await this.db.query(`DELETE FROM push_tokens WHERE id::text = $1`, [id]);
    return { deleted: rowCount ?? 0 };
  }

  /** Unsubscribe every device, or every device on one event. */
  async clearSubscriptions(eventId?: string): Promise<{ deleted: number }> {
    const { rowCount } = await this.db.query(
      eventId ? `DELETE FROM push_tokens WHERE event_id = $1` : `DELETE FROM push_tokens`,
      eventId ? [eventId] : [],
    );
    return { deleted: rowCount ?? 0 };
  }

  async sendToUser(
    userId: string,
    eventId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
    opts?: PushOptions,
  ): Promise<void> {
    const { rows } = await this.db.query<{ token: string }>(
      `SELECT token FROM push_tokens WHERE user_id = $1 AND event_id = $2`,
      [userId, eventId],
    );
    if (rows.length === 0) return;
    await this.sendMessages(rows.map((r) => buildMessage(r.token, title, body, data, opts)));
  }

  async sendToEvent(
    eventId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
    opts?: PushOptions,
  ): Promise<void> {
    const { rows } = await this.db.query<{ token: string }>(
      opts?.excludeUserId
        ? `SELECT DISTINCT token FROM push_tokens WHERE event_id = $1 AND user_id <> $2`
        : `SELECT DISTINCT token FROM push_tokens WHERE event_id = $1`,
      opts?.excludeUserId ? [eventId, opts.excludeUserId] : [eventId],
    );
    if (rows.length === 0) return;
    await this.sendMessages(rows.map((r) => buildMessage(r.token, title, body, data, opts)));
  }

  private async sendMessages(messages: PushMessage[]): Promise<void> {
    // Expo push API accepts up to 100 messages per request
    const chunkSize = 100;
    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, i + chunkSize);
      try {
        const res = await fetch(this.expoUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(chunk),
        });
        if (!res.ok) {
          this.logger.warn(`Expo push API returned ${res.status}: ${await res.text()}`);
        }
      } catch (err) {
        this.logger.warn(`Failed to send push notifications: ${(err as Error).message}`);
      }
    }
  }
}
