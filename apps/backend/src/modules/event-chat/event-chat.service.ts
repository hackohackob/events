import { randomUUID } from "crypto";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type {
  EventFeedType,
  EventMessage,
  EventMessageLocation,
  PttMessageOrigin,
} from "@events/contracts";
import { DbService } from "../infra/db.service";
import { PttBusService } from "../infra/ptt-bus.service";
import { RedisService } from "../infra/redis.service";

/**
 * Event-wide team chat: a single thread per event that everyone on the response
 * team shares. It doubles as a live activity feed — incidents, responses and new
 * POIs are posted as `system` messages so the team has one timeline of what's
 * happening. Mirrors the incident-chat storage/broadcast pattern.
 *
 * It is also one end of the PTT bridges: messages written in the app are handed
 * to `PttBusService` for relay out to Zello / radio, and traffic arriving from
 * those networks is written back here via `addFromBridge` (tagged with `origin`
 * so it is never relayed back out).
 */
@Injectable()
export class EventChatService implements OnModuleInit {
  private readonly logger = new Logger(EventChatService.name);

  constructor(
    private readonly db: DbService,
    private readonly redisService: RedisService,
    private readonly pttBus: PttBusService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS event_messages (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        author_id TEXT,
        author_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        feed_type TEXT,
        text TEXT,
        audio_url TEXT,
        audio_duration_ms INTEGER,
        transcript TEXT,
        meta JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.db.query(
      `CREATE INDEX IF NOT EXISTS idx_event_messages_event ON event_messages (event_id, created_at ASC)`,
    );
    // Media + PTT provenance, added after the table shipped.
    for (const column of [
      "image_url TEXT",
      "thumbnail_url TEXT",
      "location JSONB",
      "origin TEXT",
      "origin_user TEXT",
    ]) {
      await this.db.query(`ALTER TABLE event_messages ADD COLUMN IF NOT EXISTS ${column}`);
    }
  }

  /** Most recent messages for an event, oldest → newest. */
  async list(eventId: string, limit = 200): Promise<EventMessage[]> {
    const { rows } = await this.db.query<EventMessageRow>(
      `SELECT * FROM (
         SELECT * FROM event_messages WHERE event_id = $1 ORDER BY created_at DESC LIMIT $2
       ) t ORDER BY created_at ASC`,
      [eventId, limit],
    );
    return rows.map(toEventMessage);
  }

  async addText(eventId: string, authorId: string, authorName: string, text: string): Promise<EventMessage> {
    return this.insert({ eventId, authorId, authorName, kind: "text", text });
  }

  async addVoice(
    eventId: string,
    authorId: string,
    authorName: string,
    input: { audioUrl: string; audioDurationMs?: number; transcript?: string },
  ): Promise<EventMessage> {
    return this.insert({
      eventId,
      authorId,
      authorName,
      kind: "voice",
      audioUrl: input.audioUrl,
      audioDurationMs: input.audioDurationMs,
      transcript: input.transcript,
    });
  }

  async addImage(
    eventId: string,
    authorId: string,
    authorName: string,
    input: { imageUrl: string; thumbnailUrl?: string; text?: string },
  ): Promise<EventMessage> {
    return this.insert({
      eventId,
      authorId,
      authorName,
      kind: "image",
      imageUrl: input.imageUrl,
      thumbnailUrl: input.thumbnailUrl,
      text: input.text,
    });
  }

  async addLocation(
    eventId: string,
    authorId: string,
    authorName: string,
    location: EventMessageLocation,
    text?: string,
  ): Promise<EventMessage> {
    return this.insert({ eventId, authorId, authorName, kind: "location", location, text });
  }

  /**
   * Write a message that arrived from an external PTT network. `authorId` stays
   * null (there is no app user behind it) and `origin` marks where it came
   * from, which is what stops it being relayed straight back out.
   */
  async addFromBridge(
    eventId: string,
    origin: PttMessageOrigin,
    originUser: string,
    payload: Omit<InsertInput, "eventId" | "authorId" | "authorName" | "origin" | "originUser">,
  ): Promise<EventMessage> {
    return this.insert({
      ...payload,
      eventId,
      authorId: null,
      authorName: originUser,
      origin,
      originUser,
    });
  }

  /** Post a system feed entry (incident raised, medic responding, POI added). */
  async postSystem(
    eventId: string,
    feedType: EventFeedType,
    text: string,
    meta?: Record<string, unknown>,
  ): Promise<EventMessage> {
    return this.insert({ eventId, authorId: null, authorName: "System", kind: "system", feedType, text, meta });
  }

  /** Best-effort display name from the medic roster, else a role-ish fallback. */
  async resolveAuthorName(eventId: string, authorId: string): Promise<string> {
    try {
      const { rows } = await this.db.query<{ name: string }>(
        `SELECT name FROM event_medics WHERE id::text = $1 AND event_id = $2`,
        [authorId, eventId],
      );
      return rows[0]?.name ?? "Team";
    } catch {
      return "Team";
    }
  }

  private async insert(msg: InsertInput): Promise<EventMessage> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db.query(
      `INSERT INTO event_messages
         (id, event_id, author_id, author_name, kind, feed_type, text, audio_url, audio_duration_ms,
          transcript, image_url, thumbnail_url, location, origin, origin_user, meta, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        id,
        msg.eventId,
        msg.authorId,
        msg.authorName,
        msg.kind,
        msg.feedType ?? null,
        msg.text ?? null,
        msg.audioUrl ?? null,
        msg.audioDurationMs ?? null,
        msg.transcript ?? null,
        msg.imageUrl ?? null,
        msg.thumbnailUrl ?? null,
        msg.location ? JSON.stringify(msg.location) : null,
        msg.origin ?? null,
        msg.originUser ?? null,
        msg.meta ? JSON.stringify(msg.meta) : null,
        now,
      ],
    );

    const message: EventMessage = {
      id,
      eventId: msg.eventId,
      authorId: msg.authorId,
      authorName: msg.authorName,
      kind: msg.kind,
      feedType: msg.feedType,
      text: msg.text,
      audioUrl: msg.audioUrl,
      audioDurationMs: msg.audioDurationMs,
      transcript: msg.transcript,
      imageUrl: msg.imageUrl,
      thumbnailUrl: msg.thumbnailUrl,
      location: msg.location,
      origin: msg.origin,
      originUser: msg.originUser,
      meta: msg.meta,
      createdAt: now,
    };

    // Everyone on the event (all roles) joins the `ops` room on connect.
    await this.redisService.publish(`event:${msg.eventId}:ops`, {
      type: "event.message",
      payload: message,
    });

    // Relay out to the PTT bridges — but only messages that originated in the
    // app. Anything tagged with an external origin is already on the air, and
    // echoing it back would loop. System feed entries stay in the app.
    if (!message.origin && message.kind !== "system") {
      try {
        this.pttBus.publishOutbound(message);
      } catch (err) {
        this.logger.warn(`PTT relay skipped: ${(err as Error).message}`);
      }
    }

    return message;
  }
}

interface InsertInput {
  eventId: string;
  authorId: string | null;
  authorName: string;
  kind: EventMessage["kind"];
  feedType?: EventFeedType;
  text?: string;
  audioUrl?: string;
  audioDurationMs?: number;
  transcript?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  location?: EventMessageLocation;
  origin?: PttMessageOrigin;
  originUser?: string;
  meta?: Record<string, unknown>;
}

interface EventMessageRow {
  id: string;
  event_id: string;
  author_id: string | null;
  author_name: string;
  kind: string;
  feed_type: string | null;
  text: string | null;
  audio_url: string | null;
  audio_duration_ms: number | null;
  transcript: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  location: EventMessageLocation | null;
  origin: string | null;
  origin_user: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

function toEventMessage(r: EventMessageRow): EventMessage {
  return {
    id: r.id,
    eventId: r.event_id,
    authorId: r.author_id,
    authorName: r.author_name,
    kind: r.kind as EventMessage["kind"],
    feedType: (r.feed_type as EventFeedType | null) ?? undefined,
    text: r.text ?? undefined,
    audioUrl: r.audio_url ?? undefined,
    audioDurationMs: r.audio_duration_ms ?? undefined,
    transcript: r.transcript ?? undefined,
    imageUrl: r.image_url ?? undefined,
    thumbnailUrl: r.thumbnail_url ?? undefined,
    location: r.location ?? undefined,
    origin: (r.origin as PttMessageOrigin | null) ?? undefined,
    originUser: r.origin_user ?? undefined,
    meta: r.meta ?? undefined,
    createdAt: typeof r.created_at === "string" ? r.created_at : new Date(r.created_at).toISOString(),
  };
}
