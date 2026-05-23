import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { MedicDestination, MedicState, MedicStatus } from "@events/contracts";
import { DbService } from "../infra/db.service";
import { RedisService } from "../infra/redis.service";
import { NotificationsService } from "../notifications/notifications.service";

export interface UpsertMedicLocationParams {
  eventId: string;
  medicId: string;
  name: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
}

@Injectable()
export class MedicsService {
  private readonly logger = new Logger(MedicsService.name);

  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Roster ──────────────────────────────────────────────────────────────

  async getMedicRoster(eventId: string) {
    const { rows } = await this.db.query<{ id: string; name: string; unit?: string; vehicle?: string }>(
      "SELECT id, name, unit, vehicle FROM event_medics WHERE event_id = $1 ORDER BY name",
      [eventId],
    );
    return rows;
  }

  async addMedic(eventId: string, data: { name: string; unit?: string; vehicle?: string }) {
    const { rows } = await this.db.query<{ id: string; name: string; unit?: string; vehicle?: string }>(
      `INSERT INTO event_medics (event_id, name, unit, vehicle)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id, name) DO UPDATE SET unit = EXCLUDED.unit, vehicle = EXCLUDED.vehicle
       RETURNING id, name, unit, vehicle`,
      [eventId, data.name, data.unit ?? null, data.vehicle ?? null],
    );
    return rows[0];
  }

  async getMedicById(eventId: string, medicId: string) {
    const { rows } = await this.db.query<{ id: string; name: string; unit?: string; vehicle?: string }>(
      "SELECT id, name, unit, vehicle FROM event_medics WHERE event_id = $1 AND id = $2",
      [eventId, medicId],
    );
    return rows[0] ?? null;
  }

  async getMedicState(eventId: string, medicId: string): Promise<MedicState | null> {
    return this.getMedicLastLocation(eventId, medicId);
  }

  // ─── Live location ────────────────────────────────────────────────────────

  async upsertMedicLocation(params: UpsertMedicLocationParams): Promise<MedicState> {
    const now = new Date().toISOString();

    // Preserve existing status/destination so a location ping doesn't clear an assignment
    const existing = await this.getMedicLastLocation(params.eventId, params.medicId);

    const state: MedicState = {
      medicId: params.medicId,
      eventId: params.eventId,
      name: params.name,
      lat: params.lat,
      lng: params.lng,
      heading: params.heading,
      speed: params.speed,
      accuracy: params.accuracy,
      status: existing?.status ?? "available",
      destination: existing?.destination ?? null,
      recordedAt: now,
      lastSeenAt: now,
    };

    await this.db.query(
      `INSERT INTO medic_last_location
         (medic_id, event_id, name, lat, lng, heading, speed, accuracy, status, destination, recorded_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (event_id, medic_id) DO UPDATE SET
         name        = EXCLUDED.name,
         lat         = EXCLUDED.lat,
         lng         = EXCLUDED.lng,
         heading     = EXCLUDED.heading,
         speed       = EXCLUDED.speed,
         accuracy    = EXCLUDED.accuracy,
         recorded_at = EXCLUDED.recorded_at,
         last_seen_at = EXCLUDED.last_seen_at`,
      [
        params.medicId, params.eventId, params.name,
        params.lat, params.lng, params.heading ?? null,
        params.speed ?? null, params.accuracy ?? null,
        state.status, state.destination ? JSON.stringify(state.destination) : null,
        now, now,
      ],
    );

    await this.redis.publish(`event:${params.eventId}:map`, {
      type: "medic_location",
      payload: state,
    });

    return state;
  }

  async assignDestination(
    eventId: string,
    medicId: string,
    destination: MedicDestination | null,
  ): Promise<MedicState> {
    const existing = await this.getMedicLastLocation(eventId, medicId);
    if (!existing) {
      throw new NotFoundException(`Medic ${medicId} has no location recorded for event ${eventId}`);
    }

    const status: MedicStatus = destination ? "going_to" : "available";
    const now = new Date().toISOString();

    await this.db.query(
      `UPDATE medic_last_location
       SET status = $1, destination = $2, last_seen_at = $3
       WHERE event_id = $4 AND medic_id = $5`,
      [status, destination ? JSON.stringify(destination) : null, now, eventId, medicId],
    );

    const updated: MedicState = { ...existing, status, destination: destination ?? null, lastSeenAt: now };

    await this.redis.publish(`event:${eventId}:map`, {
      type: "medic_location",
      payload: updated,
    });

    if (destination) {
      await this.notifications.sendToUser(
        medicId,
        eventId,
        "📍 New Assignment",
        `Head to: ${destination.label}`,
        { medicId, eventId, label: destination.label },
      );
    }

    return updated;
  }

  async getActiveMedics(eventId: string): Promise<MedicState[]> {
    const { rows } = await this.db.query<{
      medic_id: string;
      event_id: string;
      name: string;
      lat: number;
      lng: number;
      heading: number | null;
      speed: number | null;
      accuracy: number | null;
      status: string;
      destination: unknown;
      recorded_at: string;
      last_seen_at: string;
    }>(
      `SELECT medic_id, event_id, name, lat, lng, heading, speed, accuracy,
              status, destination, recorded_at, last_seen_at
       FROM medic_last_location
       WHERE event_id = $1
       ORDER BY name`,
      [eventId],
    );

    return rows.map((r) => ({
      medicId: r.medic_id,
      eventId: r.event_id,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      heading: r.heading ?? undefined,
      speed: r.speed ?? undefined,
      accuracy: r.accuracy ?? undefined,
      status: r.status as MedicStatus,
      destination: r.destination as MedicDestination | null,
      recordedAt: r.recorded_at,
      lastSeenAt: r.last_seen_at,
    }));
  }

  private async getMedicLastLocation(eventId: string, medicId: string): Promise<MedicState | null> {
    const { rows } = await this.db.query<{
      medic_id: string;
      event_id: string;
      name: string;
      lat: number;
      lng: number;
      heading: number | null;
      speed: number | null;
      accuracy: number | null;
      status: string;
      destination: unknown;
      recorded_at: string;
      last_seen_at: string;
    }>(
      `SELECT medic_id, event_id, name, lat, lng, heading, speed, accuracy,
              status, destination, recorded_at, last_seen_at
       FROM medic_last_location
       WHERE event_id = $1 AND medic_id = $2`,
      [eventId, medicId],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      medicId: r.medic_id,
      eventId: r.event_id,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      heading: r.heading ?? undefined,
      speed: r.speed ?? undefined,
      accuracy: r.accuracy ?? undefined,
      status: r.status as MedicStatus,
      destination: r.destination as MedicDestination | null,
      recordedAt: r.recorded_at,
      lastSeenAt: r.last_seen_at,
    };
  }

  async removeActiveMedic(eventId: string, medicId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM medic_last_location WHERE event_id = $1 AND medic_id = $2`,
      [eventId, medicId],
    );
  }

  // ─── Participant location ─────────────────────────────────────────────────

  async upsertParticipantLocation(params: {
    userId: string;
    eventId: string;
    name: string;
    bibNumber?: string;
    phone?: string;
    lat: number;
    lng: number;
    accuracy?: number;
    timestamp: string;
  }): Promise<void> {
    const now = new Date().toISOString();

    await this.db.query(
      `INSERT INTO participant_last_location
         (user_id, event_id, name, bib_number, phone, lat, lng, accuracy, recorded_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (event_id, user_id) DO UPDATE SET
         lat         = EXCLUDED.lat,
         lng         = EXCLUDED.lng,
         accuracy    = EXCLUDED.accuracy,
         recorded_at = EXCLUDED.recorded_at,
         last_seen_at = EXCLUDED.last_seen_at`,
      [
        params.userId, params.eventId, params.name,
        params.bibNumber ?? null, params.phone ?? null,
        params.lat, params.lng, params.accuracy ?? null,
        params.timestamp, now,
      ],
    );

    // Sparse history: only write if the last history entry is >60s old
    const { rows } = await this.db.query<{ recorded_at: string }>(
      `SELECT recorded_at FROM participant_location_history
       WHERE event_id = $1 AND user_id = $2
       ORDER BY recorded_at DESC LIMIT 1`,
      [params.eventId, params.userId],
    );

    const lastTs = rows[0]?.recorded_at ? new Date(rows[0].recorded_at).getTime() : 0;
    const elapsed = Date.now() - lastTs;

    if (elapsed >= 60_000) {
      await this.db.query(
        `INSERT INTO participant_location_history (user_id, event_id, lat, lng, accuracy, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [params.userId, params.eventId, params.lat, params.lng, params.accuracy ?? null, params.timestamp],
      );
    }

    // Publish real-time update so the dashboard gets a live participant count
    await this.redis.publish(`event:${params.eventId}:map`, {
      type: 'location.updated',
      payload: {
        userId: params.userId,
        eventId: params.eventId,
        lat: params.lat,
        lng: params.lng,
        accuracy: params.accuracy ?? null,
        timestamp: params.timestamp,
        role: 'runner',
        name: params.name,
        bibNumber: params.bibNumber ?? null,
      },
    });
  }

  async getParticipants(eventId: string) {
    const { rows } = await this.db.query<{
      user_id: string;
      event_id: string;
      name: string;
      bib_number: string | null;
      phone: string | null;
      lat: number;
      lng: number;
      recorded_at: string;
      last_seen_at: string;
    }>(
      `SELECT user_id, event_id, name, bib_number, phone, lat, lng, recorded_at, last_seen_at
       FROM participant_last_location
       WHERE event_id = $1
       ORDER BY name`,
      [eventId],
    );
    return rows.map((r) => ({
      userId: r.user_id,
      eventId: r.event_id,
      name: r.name,
      bibNumber: r.bib_number ?? undefined,
      phone: r.phone ?? undefined,
      lat: r.lat,
      lng: r.lng,
      recordedAt: r.recorded_at,
      lastSeenAt: r.last_seen_at,
    }));
  }
}
