import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
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
  /**
   * iOS `content-available: 1`. Expo turns this into an APNs *background*
   * push (`apns-push-type: background`), which wakes the app's background
   * task without drawing anything and without making a sound. Must be sent
   * with no title/body/sound, or iOS treats it as a normal alert.
   */
  _contentAvailable?: boolean;
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

/**
 * A push that exists only to wake the app — no title, no body, no sound, no
 * channel, nothing in the tray on either platform.
 *
 * `priority: "normal"` is not a preference: APNs REJECTS a background push
 * sent at priority 10, and Expo derives the APNs priority from this field.
 * On Android the same message arrives as a data-only FCM message, which the
 * background push task receives without the OS drawing a notification.
 */
function buildSilentMessage(token: string, data: Record<string, unknown>, priority: "normal" | "high" = "normal"): PushMessage {
  return { to: token, data, priority, _contentAvailable: true };
}

/**
 * Tokens carry no platform (every row says "expo"), but `device_id` is
 * Constants.deviceName, which iOS 16+ reports as plain "iPhone"/"iPad". Used
 * only to keep a high-priority silent push away from APNs, which rejects it.
 */
function looksLikeIos(deviceId: string | null): boolean {
  return /\bi(phone|pad|pod)\b/i.test(deviceId ?? "");
}

/** What became of the last push sent to one device. */
export interface PushDelivery {
  at: string;
  ok: boolean;
  /** Expo's error code (`DeviceNotRegistered`, `MessageRateExceeded` …) or message. */
  error?: string;
}

interface ExpoTicket {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Expo accepts up to 100 messages per send and 1000 ids per receipt lookup. */
const SEND_CHUNK = 100;
const RECEIPT_CHUNK = 300;
/** How often accepted pushes are checked for what the carrier did with them. */
const RECEIPT_SWEEP_MS = 2 * 60_000;
/** Receipts are not instant; asking sooner just returns nothing. */
const RECEIPT_MIN_AGE_MS = 45_000;
/** Expo keeps receipts for about a day; past this an answer is not coming. */
const RECEIPT_GIVE_UP_MS = 60 * 60_000;
/** Bound on tickets awaiting a receipt, so a broadcast storm cannot grow it without limit. */
const MAX_PENDING_RECEIPTS = 5000;

/** Last 8 characters — enough to tell two devices apart in a log, not enough to push. */
function tokenTail(token: string): string {
  return token.replace(/\]$/, "").slice(-8);
}

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly expoUrl = "https://exp.host/--/api/v2/push/send";
  private readonly expoReceiptsUrl = "https://exp.host/--/api/v2/push/getReceipts";

  /**
   * Whether pushes actually get through, per device token.
   *
   * "We have a token" was the only thing this service ever knew, and it is not
   * the same as "the phone hears us": Expo answers 200 to a send whose token is
   * dead, and reports the failure in the per-message ticket — or only later, in
   * the receipt, once Apple/Google have refused it. Both are read now.
   */
  private readonly delivery = new Map<string, PushDelivery>();
  /** Accepted tickets whose receipt has not been read yet: id → device. */
  private readonly pendingReceipts = new Map<string, { token: string; sentAt: number }>();
  private receiptTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly db: DbService) {}

  onModuleDestroy() {
    if (this.receiptTimer) clearInterval(this.receiptTimer);
    this.receiptTimer = null;
  }

  async onModuleInit() {
    this.receiptTimer = setInterval(() => void this.sweepReceipts(), RECEIPT_SWEEP_MS);
    // Never the reason a shutdown hangs.
    this.receiptTimer.unref?.();

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

  /**
   * Drop a device's registration — called when someone leaves an event, so a
   * phone that is no longer on duty stops alarming. Keyed on the token alone:
   * the caller physically holds it, and it identifies the device regardless of
   * which user_id the row was last written under.
   */
  async unregisterToken(token: string): Promise<{ deleted: number }> {
    const { rowCount } = await this.db.query(`DELETE FROM push_tokens WHERE token = $1`, [token]);
    return { deleted: rowCount ?? 0 };
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

  /**
   * Wake one medic's devices silently. Nothing is displayed and nothing is
   * audible; the app's background push task is the only thing that sees it.
   * Returns how many devices were pinged.
   */
  /**
   * `urgent` sends Android devices a HIGH-priority FCM message: normal-priority
   * data messages are held while the phone dozes, which delayed dashboard
   * "Fix now" answers by ~15 min at Aleko Steps (Oct 2026). iOS stays at
   * normal regardless — APNs rejects high-priority background pushes.
   */
  async sendSilentToUser(
    userId: string,
    eventId: string,
    data: Record<string, unknown>,
    opts: { urgent?: boolean } = {},
  ): Promise<number> {
    const { rows } = await this.db.query<{ token: string; device_id: string | null }>(
      `SELECT token, device_id FROM push_tokens WHERE user_id = $1 AND event_id = $2`,
      [userId, eventId],
    );
    if (rows.length === 0) return 0;
    await this.sendMessages(
      rows.map((r) => buildSilentMessage(r.token, data, opts.urgent && !looksLikeIos(r.device_id) ? "high" : "normal")),
    );
    return rows.length;
  }

  /**
   * Push to whoever is signed in under a given roster name, on any event.
   *
   * Addressed by NAME rather than by id on purpose: this is for the handful of
   * alerts that belong to one person — the operator who keeps the bridges
   * running — whose medic id differs from event to event, and who wants to hear
   * about it whichever event is live. Matching is case- and whitespace-
   * insensitive; the name captured at registration wins, with the live roster
   * as the fallback for devices registered before that column existed.
   *
   * Returns how many devices were pushed, so a caller can log the silence when
   * that person has no device registered anywhere.
   */
  async sendToUserName(
    name: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
    opts?: PushOptions,
  ): Promise<number> {
    const wanted = name.trim();
    if (!wanted) return 0;
    const { rows } = await this.db.query<{ token: string }>(
      `SELECT DISTINCT p.token
         FROM push_tokens p
         LEFT JOIN event_medics em ON em.id::text = p.user_id AND em.event_id = p.event_id
        WHERE lower(btrim(COALESCE(p.user_name, em.name, ''))) = lower(btrim($1))`,
      [wanted],
    );
    if (rows.length === 0) return 0;
    await this.sendMessages(rows.map((r) => buildMessage(r.token, title, body, data, opts)));
    return rows.length;
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

  /**
   * The newest delivery outcome for each user with a device on this event.
   * Users whose pushes have simply never been attempted are absent.
   */
  async deliveryForEvent(eventId: string): Promise<Map<string, PushDelivery>> {
    const out = new Map<string, PushDelivery>();
    if (this.delivery.size === 0) return out;
    const { rows } = await this.db.query<{ user_id: string; token: string }>(
      `SELECT user_id, token FROM push_tokens WHERE event_id = $1`,
      [eventId],
    );
    for (const row of rows) {
      const seen = this.delivery.get(row.token);
      if (!seen) continue;
      const current = out.get(row.user_id);
      // Several devices: a failure anywhere is the one worth showing.
      if (!current || (current.ok && !seen.ok) || (current.ok === seen.ok && seen.at > current.at)) {
        out.set(row.user_id, seen);
      }
    }
    return out;
  }

  private async sendMessages(messages: PushMessage[]): Promise<void> {
    for (let i = 0; i < messages.length; i += SEND_CHUNK) {
      const chunk = messages.slice(i, i + SEND_CHUNK);
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
          continue;
        }
        // A 200 only means Expo took the request. Whether each message was
        // accepted is in its ticket, in the order the messages were sent.
        const parsed = (await res.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
        await this.readTickets(chunk, Array.isArray(parsed?.data) ? parsed.data : []);
      } catch (err) {
        this.logger.warn(`Failed to send push notifications: ${(err as Error).message}`);
      }
    }
  }

  private async readTickets(sent: PushMessage[], tickets: ExpoTicket[]): Promise<void> {
    const now = Date.now();
    for (let i = 0; i < sent.length; i += 1) {
      const token = sent[i]!.to;
      const ticket = tickets[i];
      if (!ticket) continue;
      if (ticket.status === "ok") {
        this.delivery.set(token, { at: new Date(now).toISOString(), ok: true });
        if (ticket.id && this.pendingReceipts.size < MAX_PENDING_RECEIPTS) {
          this.pendingReceipts.set(ticket.id, { token, sentAt: now });
        }
        continue;
      }
      await this.noteFailure(token, ticket.details?.error ?? ticket.message ?? "rejected", "ticket");
    }
  }

  /**
   * Ask Expo what Apple/Google did with the pushes it accepted. This is where
   * a dead token actually surfaces: the ticket for it is usually "ok".
   */
  private async sweepReceipts(): Promise<void> {
    const now = Date.now();
    const due: string[] = [];
    for (const [id, entry] of this.pendingReceipts) {
      const age = now - entry.sentAt;
      if (age > RECEIPT_GIVE_UP_MS) this.pendingReceipts.delete(id);
      else if (age >= RECEIPT_MIN_AGE_MS) due.push(id);
    }
    for (let i = 0; i < due.length; i += RECEIPT_CHUNK) {
      const ids = due.slice(i, i + RECEIPT_CHUNK);
      try {
        const res = await fetch(this.expoReceiptsUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) {
          this.logger.warn(`Expo receipts API returned ${res.status}`);
          continue;
        }
        const parsed = (await res.json().catch(() => null)) as { data?: Record<string, ExpoTicket> } | null;
        for (const [id, receipt] of Object.entries(parsed?.data ?? {})) {
          const entry = this.pendingReceipts.get(id);
          this.pendingReceipts.delete(id);
          if (!entry || receipt.status !== "error") continue;
          await this.noteFailure(entry.token, receipt.details?.error ?? receipt.message ?? "failed", "receipt");
        }
      } catch (err) {
        this.logger.warn(`Failed to read push receipts: ${(err as Error).message}`);
      }
    }
  }

  private async noteFailure(token: string, error: string, source: "ticket" | "receipt"): Promise<void> {
    this.delivery.set(token, { at: new Date().toISOString(), ok: false, error });
    this.logger.warn(`Push to device …${tokenTail(token)} failed (${source}): ${error}`);
    // The one failure with a known cure: the token is dead (app uninstalled,
    // or re-issued). Keeping it means every alarm "goes out" to nobody, and the
    // dashboard keeps saying the medic is reachable. Dropping it makes them
    // show up as unregistered until the phone opens the app and re-registers.
    if (error === "DeviceNotRegistered") {
      const { rowCount } = await this.db
        .query(`DELETE FROM push_tokens WHERE token = $1`, [token])
        .catch(() => ({ rowCount: 0 }));
      if (rowCount) this.logger.warn(`Dropped dead push registration …${tokenTail(token)}`);
    }
  }
}
