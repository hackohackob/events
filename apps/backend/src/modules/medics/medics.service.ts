import { ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { MedicDestination, MedicRoute, MedicState, MedicStatus, MedicType, PublicMedicState } from "@events/contracts";
import { DbService } from "../infra/db.service";
import { RedisService } from "../infra/redis.service";
import { NotificationsService } from "../notifications/notifications.service";

interface RosterRow {
  id: string;
  name: string;
  unit: string | null;
  vehicle: string | null;
  type: string | null;
  skills: unknown;
  capabilities: unknown;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function rosterRowToMedic(r: RosterRow) {
  return {
    id: r.id,
    name: r.name,
    unit: r.unit ?? undefined,
    vehicle: r.vehicle ?? undefined,
    type: (r.type ?? undefined) as MedicType | undefined,
    skills: asStringArray(r.skills),
    capabilities: asStringArray(r.capabilities),
  };
}

export interface UpsertMedicLocationParams {
  eventId: string;
  medicId: string;
  name: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  battery?: number;
  /** Client-side fix time (ISO). Falls back to server time when absent. */
  timestamp?: string;
}

@Injectable()
export class MedicsService implements OnModuleInit {
  private readonly logger = new Logger(MedicsService.name);

  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    // Idempotent column additions — safe to run on every boot
    const alterations = [
      `ALTER TABLE medic_last_location ADD COLUMN IF NOT EXISTS battery DOUBLE PRECISION`,
      `ALTER TABLE medic_last_location ADD COLUMN IF NOT EXISTS nav_route JSONB`,
      `ALTER TABLE participant_last_location ADD COLUMN IF NOT EXISTS battery DOUBLE PRECISION`,
      `ALTER TABLE event_medics ADD COLUMN IF NOT EXISTS type TEXT`,
      `ALTER TABLE event_medics ADD COLUMN IF NOT EXISTS skills JSONB NOT NULL DEFAULT '[]'`,
      `ALTER TABLE event_medics ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '[]'`,
    ];
    for (const sql of alterations) {
      await this.db.query(sql).catch((err) => this.logger.warn(`battery column migration skipped: ${String(err)}`));
    }
  }

  /** Drop malformed destinations (e.g. `{}` or missing coords) so clients never
   *  receive a `[NaN, NaN]` marker that crashes the native map. */
  private sanitizeDestination(value: unknown): MedicDestination | null {
    if (!value || typeof value !== "object") return null;
    const d = value as Record<string, unknown>;
    return Number.isFinite(d.lat) && Number.isFinite(d.lng)
      ? { lat: d.lat as number, lng: d.lng as number, label: typeof d.label === "string" ? d.label : "" }
      : null;
  }

  // ─── Roster ──────────────────────────────────────────────────────────────

  async getMedicRoster(eventId: string) {
    // `type` (coordinator vs paramedic) is the user's global role, resolved live
    // from `users` by name — never stored on the event. Changing a user's role
    // applies to every event the moment the roster is fetched.
    const { rows } = await this.db.query<RosterRow>(
      `SELECT em.id, em.name, em.unit, em.vehicle,
              CASE WHEN u.role = 'coordinator' THEN 'coordinator' ELSE 'paramedic' END AS type,
              em.skills, em.capabilities
       FROM event_medics em
       LEFT JOIN users u ON u.name = em.name
       WHERE em.event_id = $1
       ORDER BY em.name`,
      [eventId],
    );
    return rows.map(rosterRowToMedic);
  }

  async addMedic(
    eventId: string,
    data: { name: string; unit?: string; vehicle?: string; type?: MedicType; skills?: string[]; capabilities?: string[] },
  ) {
    const { rows } = await this.db.query<RosterRow>(
      `INSERT INTO event_medics (event_id, name, unit, vehicle, type, skills, capabilities)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       ON CONFLICT (event_id, name) DO UPDATE SET
         unit = EXCLUDED.unit,
         vehicle = EXCLUDED.vehicle,
         type = EXCLUDED.type,
         skills = EXCLUDED.skills,
         capabilities = EXCLUDED.capabilities
       RETURNING id, name, unit, vehicle, type, skills, capabilities`,
      [
        eventId,
        data.name,
        data.unit ?? null,
        data.vehicle ?? null,
        data.type ?? null,
        JSON.stringify(data.skills ?? []),
        JSON.stringify(data.capabilities ?? []),
      ],
    );
    return rosterRowToMedic(rows[0]);
  }

  async getMedicById(eventId: string, medicId: string) {
    const { rows } = await this.db.query<RosterRow>(
      "SELECT id, name, unit, vehicle, type, skills, capabilities FROM event_medics WHERE event_id = $1 AND id = $2",
      [eventId, medicId],
    );
    return rows[0] ? rosterRowToMedic(rows[0]) : null;
  }

  async isCoordinator(eventId: string, medicId: string): Promise<boolean> {
    // Coordinator status is the user's global role, looked up live from `users`
    // (matched by name) — not stored on the event roster.
    const { rows } = await this.db.query<{ role: string | null }>(
      `SELECT u.role
       FROM event_medics em
       LEFT JOIN users u ON u.name = em.name
       WHERE em.event_id = $1 AND em.id = $2`,
      [eventId, medicId],
    );
    return rows[0]?.role === "coordinator";
  }

  async getMedicState(eventId: string, medicId: string): Promise<MedicState | null> {
    return this.getMedicLastLocation(eventId, medicId);
  }

  // ─── Live location ────────────────────────────────────────────────────────

  async upsertMedicLocation(params: UpsertMedicLocationParams): Promise<MedicState> {
    const now = new Date().toISOString();
    // Honour the client's fix time so a backlog flushed after a Doze freeze
    // doesn't masquerade as a live position; ignore unparsable/future values.
    const clientTs = params.timestamp ? Date.parse(params.timestamp) : NaN;
    const recordedAt = Number.isFinite(clientTs) && clientTs <= Date.now() ? new Date(clientTs).toISOString() : now;

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
      battery: params.battery,
      status: existing?.status ?? "available",
      destination: existing?.destination ?? null,
      route: existing?.route ?? null,
      recordedAt,
      lastSeenAt: now,
    };

    await this.db.query(
      `INSERT INTO medic_last_location
         (medic_id, event_id, name, lat, lng, heading, speed, accuracy, battery, status, destination, nav_route, recorded_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (event_id, medic_id) DO UPDATE SET
         name        = EXCLUDED.name,
         lat         = EXCLUDED.lat,
         lng         = EXCLUDED.lng,
         heading     = EXCLUDED.heading,
         speed       = EXCLUDED.speed,
         accuracy    = EXCLUDED.accuracy,
         battery     = EXCLUDED.battery,
         recorded_at = EXCLUDED.recorded_at,
         last_seen_at = EXCLUDED.last_seen_at`,
      [
        params.medicId, params.eventId, params.name,
        params.lat, params.lng, params.heading ?? null,
        params.speed ?? null, params.accuracy ?? null, params.battery ?? null,
        state.status, state.destination ? JSON.stringify(state.destination) : null,
        state.route ? JSON.stringify(state.route) : null,
        recordedAt, now,
      ],
    );

    await this.redis.publish(`event:${params.eventId}:map`, {
      type: "medic_location",
      payload: state,
    });

    return state;
  }

  /**
   * Assign (or clear) a medic's destination.
   *
   * @param requesterId  Who initiated this. Self-assignment (requesterId === medicId)
   *                     is always allowed; assigning *another* medic requires the
   *                     requester to be a coordinator (roster type) or the dashboard.
   * @param requesterIsCoordinatorRole  True when the caller's session role is
   *                     "coordinator" (the dashboard).
   */
  async assignDestination(
    eventId: string,
    medicId: string,
    destination: MedicDestination | null,
    requesterId?: string,
    requesterIsCoordinatorRole = false,
  ): Promise<MedicState> {
    const isSelf = !requesterId || requesterId === medicId;
    if (!isSelf && !requesterIsCoordinatorRole) {
      const requesterIsCoordinator = await this.isCoordinator(eventId, requesterId!);
      if (!requesterIsCoordinator) {
        throw new ForbiddenException("Only a coordinator can assign another medic");
      }
    }

    const existing = await this.getMedicLastLocation(eventId, medicId);
    if (!existing) {
      throw new NotFoundException(`Medic ${medicId} has no location recorded for event ${eventId}`);
    }

    // Drop malformed destinations (e.g. `{}` from undefined coords) before storing.
    destination = this.sanitizeDestination(destination);
    const status: MedicStatus = destination ? "going_to" : "available";
    const now = new Date().toISOString();

    // A plain destination assignment clears any standing nav path (the path is
    // only attached via setMedicRoute when the medic actually navigates).
    await this.db.query(
      `UPDATE medic_last_location
       SET status = $1, destination = $2, nav_route = NULL, last_seen_at = $3
       WHERE event_id = $4 AND medic_id = $5`,
      [status, destination ? JSON.stringify(destination) : null, now, eventId, medicId],
    );

    const updated: MedicState = { ...existing, status, destination: destination ?? null, route: null, lastSeenAt: now };

    await this.redis.publish(`event:${eventId}:map`, {
      type: "medic_location",
      payload: updated,
    });

    // Notify the assigned medic only when somebody else dispatched them.
    if (destination && !isSelf) {
      await this.notifications.sendToUser(
        medicId,
        eventId,
        "📍 New Assignment",
        `Head to: ${destination.label}`,
        { medicId, eventId, label: destination.label, kind: "assignment" },
      );
    }

    return updated;
  }

  /**
   * Attach (or clear) the active navigation path a medic is following, so the
   * whole team + dashboard can see the coloured route + ETA. Setting a route
   * also marks the medic "going_to" with the route's destination.
   */
  async setMedicRoute(
    eventId: string,
    medicId: string,
    route: MedicRoute | null,
    destination: MedicDestination | null,
  ): Promise<MedicState> {
    const existing = await this.getMedicLastLocation(eventId, medicId);
    if (!existing) {
      throw new NotFoundException(`Medic ${medicId} has no location recorded for event ${eventId}`);
    }
    const now = new Date().toISOString();
    const status: MedicStatus = route ? "going_to" : (existing.status === "going_to" ? "available" : existing.status);
    const nextDestination = route ? (this.sanitizeDestination(destination) ?? existing.destination ?? null) : null;

    await this.db.query(
      `UPDATE medic_last_location
       SET status = $1, destination = $2, nav_route = $3, last_seen_at = $4
       WHERE event_id = $5 AND medic_id = $6`,
      [
        status,
        nextDestination ? JSON.stringify(nextDestination) : null,
        route ? JSON.stringify(route) : null,
        now, eventId, medicId,
      ],
    );

    const updated: MedicState = {
      ...existing,
      status,
      destination: nextDestination,
      route: route ?? null,
      lastSeenAt: now,
    };
    await this.redis.publish(`event:${eventId}:map`, { type: "medic_location", payload: updated });
    return updated;
  }

  /** Manually set a medic's status (Available / Stationary / Rest). "going_to" is set via assignDestination. */
  async updateStatus(
    eventId: string,
    medicId: string,
    status: Extract<MedicStatus, "available" | "stationary" | "rest">,
  ): Promise<MedicState> {
    const existing = await this.getMedicLastLocation(eventId, medicId);
    if (!existing) {
      throw new NotFoundException(`Medic ${medicId} has no location recorded for event ${eventId}`);
    }

    const now = new Date().toISOString();
    // Switching to a manual status always clears any standing destination + path.
    await this.db.query(
      `UPDATE medic_last_location
       SET status = $1, destination = NULL, nav_route = NULL, last_seen_at = $2
       WHERE event_id = $3 AND medic_id = $4`,
      [status, now, eventId, medicId],
    );

    const updated: MedicState = { ...existing, status, destination: null, route: null, lastSeenAt: now };

    await this.redis.publish(`event:${eventId}:map`, {
      type: "medic_location",
      payload: updated,
    });

    return updated;
  }

  /** Dashboard alert blasted to every device registered to the event. */
  async broadcast(eventId: string, title: string, body: string): Promise<{ ok: true }> {
    await this.notifications.sendToEvent(eventId, title, body, {
      eventId,
      kind: "broadcast",
    });
    await this.redis.publish(`event:${eventId}:ops`, {
      type: "broadcast",
      payload: { title, body, sentAt: new Date().toISOString() },
    });
    return { ok: true };
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
      battery: number | null;
      status: string;
      destination: unknown;
      nav_route: unknown;
      recorded_at: string;
      last_seen_at: string;
    }>(
      `SELECT medic_id, event_id, name, lat, lng, heading, speed, accuracy, battery,
              status, destination, nav_route, recorded_at, last_seen_at
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
      battery: r.battery ?? undefined,
      status: r.status as MedicStatus,
      destination: this.sanitizeDestination(r.destination),
      route: (r.nav_route as MedicState["route"]) ?? null,
      recordedAt: r.recorded_at,
      lastSeenAt: r.last_seen_at,
    }));
  }

  /**
   * Trimmed active-medic snapshot safe for runners — position + status only,
   * no battery/route/destination internals. Powers the runner map markers and
   * nearest-medic pill.
   */
  async getPublicActiveMedics(eventId: string): Promise<PublicMedicState[]> {
    const medics = await this.getActiveMedics(eventId);
    return medics.map((m) => ({
      medicId: m.medicId,
      name: m.name,
      lat: m.lat,
      lng: m.lng,
      status: m.status,
      recordedAt: m.recordedAt,
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
      battery: number | null;
      status: string;
      destination: unknown;
      nav_route: unknown;
      recorded_at: string;
      last_seen_at: string;
    }>(
      `SELECT medic_id, event_id, name, lat, lng, heading, speed, accuracy, battery,
              status, destination, nav_route, recorded_at, last_seen_at
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
      battery: r.battery ?? undefined,
      status: r.status as MedicStatus,
      destination: this.sanitizeDestination(r.destination),
      route: (r.nav_route as MedicState["route"]) ?? null,
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
    battery?: number;
    timestamp: string;
  }): Promise<void> {
    const now = new Date().toISOString();

    await this.db.query(
      `INSERT INTO participant_last_location
         (user_id, event_id, name, bib_number, phone, lat, lng, accuracy, battery, recorded_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (event_id, user_id) DO UPDATE SET
         lat         = EXCLUDED.lat,
         lng         = EXCLUDED.lng,
         accuracy    = EXCLUDED.accuracy,
         battery     = EXCLUDED.battery,
         recorded_at = EXCLUDED.recorded_at,
         last_seen_at = EXCLUDED.last_seen_at`,
      [
        params.userId, params.eventId, params.name,
        params.bibNumber ?? null, params.phone ?? null,
        params.lat, params.lng, params.accuracy ?? null, params.battery ?? null,
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

    // No per-participant WS broadcast — clients poll GET /events/:id/heatmap for
    // an aggregated snapshot instead (one call vs. a flood of events at scale).
  }

  /**
   * Aggregated heatmap snapshot — one lightweight payload (no names/bib/battery)
   * for the coordinator dashboard + medic app to poll, instead of streaming a
   * WS event per participant. Each point carries recordedAt for freshness.
   */
  async getHeatmap(eventId: string): Promise<{
    generatedAt: string;
    count: number;
    points: Array<{ lat: number; lng: number; recordedAt: string }>;
  }> {
    const { rows } = await this.db.query<{ lat: number; lng: number; recorded_at: string }>(
      `SELECT lat, lng, recorded_at FROM participant_last_location WHERE event_id = $1`,
      [eventId],
    );
    return {
      generatedAt: new Date().toISOString(),
      count: rows.length,
      points: rows.map((r) => ({ lat: r.lat, lng: r.lng, recordedAt: r.recorded_at })),
    };
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
