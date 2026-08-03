import { randomUUID } from "crypto";
import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from "@nestjs/common";
import type {
  EventFeedType,
  EventMessage,
  EventMessageLocation,
  PttMessageOrigin,
} from "@events/contracts";
import { DbService } from "../infra/db.service";
import { PttBusService } from "../infra/ptt-bus.service";
import { RedisService } from "../infra/redis.service";
import { IncidentsService } from "../incidents/incidents.service";

/**
 * How close a medic has to be to an incident for what they say in the team chat
 * to also belong on that incident's record.
 */
const NEARBY_INCIDENT_RADIUS_M = 100;

/**
 * A fix older than this says nothing about where the author is standing now, so
 * it can't put them "at" an incident. Medics on shift report far more often.
 */
const FIX_FRESHNESS_MS = 10 * 60 * 1000;

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
    // forwardRef: IncidentsService posts its feed entries here, so the two
    // services reference each other.
    @Inject(forwardRef(() => IncidentsService)) private readonly incidents: IncidentsService,
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

    // Fire-and-forget: filing a copy on a nearby incident must never slow down
    // or fail the team-chat send it came from.
    void this.mirrorToNearbyIncidents(message).catch((err) =>
      this.logger.warn(`Incident mirror skipped: ${(err as Error).message}`),
    );

    return message;
  }

  /**
   * A medic standing on top of an incident is usually talking *about* it, even
   * when they type into the team chat. Copy what they said onto every active
   * incident within {@link NEARBY_INCIDENT_RADIUS_M} so the incident record is
   * complete without asking them to repeat themselves in the right thread.
   *
   * The copy is tagged (`meta.mirroredFrom`) so clients can mark it as coming
   * from the team chat rather than the incident's own thread.
   */
  private async mirrorToNearbyIncidents(message: EventMessage): Promise<void> {
    // System feed entries and PTT traffic have no app author standing anywhere.
    if (!message.authorId || message.kind === "system" || message.origin) return;

    const fix = await this.recentMedicFix(message.eventId, message.authorId);
    if (!fix) return;

    const nearby = await this.incidents.findActiveNear(
      message.eventId,
      fix.lat,
      fix.lng,
      NEARBY_INCIDENT_RADIUS_M,
    );

    for (const incident of nearby) {
      await this.incidents.addMessage(message.eventId, incident.id, message.authorId, {
        text: mirroredText(message),
        kind: message.kind === "voice" ? "voice" : "text",
        audioUrl: message.audioUrl,
        audioDurationMs: message.audioDurationMs,
        transcript: message.transcript,
        photoUrl: message.imageUrl,
        meta: {
          mirroredFrom: "event-chat",
          eventMessageId: message.id,
          distanceMeters: Math.round(incident.distanceMeters),
        },
      });
    }
  }

  /**
   * The author's last known position, but only if it is recent enough to place
   * them somewhere right now. Reading `medic_last_location` directly also does
   * the role filtering for free — participants are in a different table.
   */
  private async recentMedicFix(
    eventId: string,
    medicId: string,
  ): Promise<{ lat: number; lng: number } | null> {
    const { rows } = await this.db.query<{ lat: number; lng: number; recorded_at: string }>(
      `SELECT lat, lng, recorded_at FROM medic_last_location WHERE event_id = $1 AND medic_id = $2`,
      [eventId, medicId],
    );
    const row = rows[0];
    if (!row || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;
    const recordedAt = new Date(row.recorded_at).getTime();
    if (!Number.isFinite(recordedAt) || Date.now() - recordedAt > FIX_FRESHNESS_MS) return null;
    return { lat: row.lat, lng: row.lng };
  }
}

/** Incident messages are text-first; give the non-text kinds a readable line. */
function mirroredText(message: EventMessage): string {
  if (message.text?.trim()) return message.text.trim();
  if (message.kind === "voice") return message.transcript?.trim() || "🎤 Voice message";
  if (message.kind === "image") return "📷 Photo";
  if (message.kind === "location" && message.location) {
    const { lat, lng, address } = message.location;
    return address?.trim() || `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
  return "";
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
