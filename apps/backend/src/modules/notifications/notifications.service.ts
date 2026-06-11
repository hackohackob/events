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

interface PushOptions {
  channelId?: string;
  /**
   * Send as a data-only message: no system-rendered notification. The app's
   * background push task receives it (even killed) and raises a full notifee
   * alarm — looping sound, strong vibration — which the OS can't do for a
   * plain notification push.
   */
  dataOnly?: boolean;
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
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, event_id, token)
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_push_tokens_event ON push_tokens (event_id)
    `);
  }

  async registerToken(
    userId: string,
    eventId: string,
    token: string,
    platform = "expo",
    deviceId?: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO push_tokens (user_id, event_id, token, platform, device_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id, event_id, token) DO UPDATE
         SET platform   = EXCLUDED.platform,
             device_id  = EXCLUDED.device_id,
             updated_at = now()`,
      [userId, eventId, token, platform, deviceId ?? null],
    );
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
      `SELECT DISTINCT token FROM push_tokens WHERE event_id = $1`,
      [eventId],
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
