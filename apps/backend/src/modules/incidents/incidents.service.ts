import { randomUUID } from "crypto";
import { ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit, forwardRef } from "@nestjs/common";
import { IncidentStatus, UserRole, IncidentCategory, INCIDENT_CATEGORY_SEVERITY } from "@events/contracts";
import { DbService } from "../infra/db.service";
import { RedisService } from "../infra/redis.service";
import { NotificationsService } from "../notifications/notifications.service";
import { MedicsService } from "../medics/medics.service";
import { CreateIncidentDto } from "./dto/create-incident.dto";
import { IncidentActionDto } from "./dto/incident-action.dto";
import { UpdateIncidentDetailsDto } from "./dto/update-incident-details.dto";

export interface IncidentRecord {
  id: string;
  eventId: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
  description: string;
  severity?: string;
  /** Standardised category from the runner PWA (free-form `type` kept for back-compat). */
  category?: string;
  /** GPS accuracy radius (metres) reported at capture time. */
  accuracy?: number;
  photoUrl?: string;
  /** All photos attached to the incident, oldest first (includes photoUrl). */
  photoUrls: string[];
  status: IncidentStatus;
  createdBy: string;
  reportedBy?: string;
  createdAt: string;
  updatedAt: string;
  responders: string[];
  nearbyParamedics?: string[];
  vitals?: string;
  treatment?: string;
  transport?: string;
  closedBy?: string;
  closedAt?: string;
  /** ISO timestamp of the most recent message on this incident (for unread
   *  indicators on the client). Undefined when there are no messages. */
  lastMessageAt?: string;
}

export interface IncidentMessageRecord {
  id: string;
  incidentId: string;
  eventId: string;
  authorId: string;
  authorName: string;
  text: string;
  photoUrl?: string;
  /** Voice message attachment (server-relative URL). */
  audioUrl?: string;
  audioDurationMs?: number;
  createdAt: string;
}

interface IncidentRow {
  id: string;
  event_id: string;
  name: string | null;
  lat: number;
  lng: number;
  type: string;
  description: string;
  severity: string | null;
  category: string | null;
  accuracy: number | null;
  photo_url: string | null;
  photo_urls: string[] | null;
  status: string;
  created_by: string;
  reporter_name: string | null;
  created_at: string;
  updated_at: string;
  responders: string[];
  vitals: string | null;
  treatment: string | null;
  transport: string | null;
  closed_by: string | null;
  closed_at: string | null;
}

function toIso(value: string | Date | null): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : new Date(value).toISOString();
}

/** Photo list = legacy single photo_url (if any) + the photo_urls array, deduped. */
function mergePhotoUrls(photoUrl: string | null, photoUrls: string[] | null): string[] {
  const list = Array.isArray(photoUrls) ? photoUrls : [];
  if (photoUrl && !list.includes(photoUrl)) return [photoUrl, ...list];
  return list;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function rowToRecord(r: IncidentRow): IncidentRecord {
  return {
    id: r.id,
    eventId: r.event_id,
    name: r.name ?? "Incident",
    lat: r.lat,
    lng: r.lng,
    type: r.type,
    description: r.description,
    severity: r.severity ?? undefined,
    category: r.category ?? undefined,
    accuracy: r.accuracy ?? undefined,
    photoUrl: r.photo_url ?? undefined,
    photoUrls: mergePhotoUrls(r.photo_url, r.photo_urls),
    status: r.status as IncidentStatus,
    createdBy: r.created_by,
    reportedBy: r.reporter_name ?? undefined,
    createdAt: typeof r.created_at === "string" ? r.created_at : new Date(r.created_at).toISOString(),
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : new Date(r.updated_at).toISOString(),
    responders: Array.isArray(r.responders) ? r.responders : [],
    vitals: r.vitals ?? undefined,
    treatment: r.treatment ?? undefined,
    transport: r.transport ?? undefined,
    closedBy: r.closed_by ?? undefined,
    closedAt: toIso(r.closed_at),
  };
}

@Injectable()
export class IncidentsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly redisService: RedisService,
    private readonly notificationsService: NotificationsService,
    // forwardRef: MedicsModule already imports IncidentsModule (its controller
    // needs IncidentsService), so the two modules reference each other.
    @Inject(forwardRef(() => MedicsService)) private readonly medicsService: MedicsService,
  ) {}

  /**
   * Stop a medic heading to an incident they're no longer assigned to: clear
   * their destination/route and flip them back to "available". Without this the
   * medic keeps the "going_to" badge + yellow dashed line after being unassigned
   * or standing down. Routed through assignDestination(null) as a self-clear
   * (requesterId === medicId bypasses the coordinator re-check) so it also
   * publishes the medic_location update every client needs.
   */
  private async clearMedicDestination(eventId: string, medicId: string): Promise<void> {
    try {
      await this.medicsService.assignDestination(eventId, medicId, null, medicId, false);
    } catch {
      // Non-fatal: the responder change already succeeded; a stale destination
      // line is preferable to failing the unassign.
    }
  }

  async onModuleInit() {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id            TEXT PRIMARY KEY,
        event_id      TEXT NOT NULL,
        lat           DOUBLE PRECISION NOT NULL DEFAULT 0,
        lng           DOUBLE PRECISION NOT NULL DEFAULT 0,
        type          TEXT NOT NULL DEFAULT 'other',
        description   TEXT NOT NULL DEFAULT '',
        severity      TEXT,
        photo_url     TEXT,
        status        TEXT NOT NULL DEFAULT 'open',
        created_by    TEXT NOT NULL DEFAULT 'system',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        responders    JSONB NOT NULL DEFAULT '[]'
      )
    `);

    // Idempotent column additions — safe to run on every boot
    const alterations = [
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS lat        DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS lng        DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS type       TEXT NOT NULL DEFAULT 'other'`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS severity   TEXT`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS photo_url  TEXT`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS status     TEXT NOT NULL DEFAULT 'open'`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system'`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reporter_name TEXT`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS responders JSONB NOT NULL DEFAULT '[]'`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS name       TEXT`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS vitals     TEXT`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS treatment  TEXT`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS transport  TEXT`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS closed_by  TEXT`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS closed_at  TIMESTAMPTZ`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS photo_urls JSONB NOT NULL DEFAULT '[]'`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS category TEXT`,
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS accuracy DOUBLE PRECISION`,
    ];
    for (const sql of alterations) {
      await this.db.query(sql);
    }

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS incident_messages (
        id          TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        event_id    TEXT NOT NULL,
        author_id   TEXT NOT NULL,
        author_name TEXT NOT NULL DEFAULT '',
        text        TEXT NOT NULL DEFAULT '',
        photo_url   TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_incident_messages_incident
        ON incident_messages (incident_id, created_at ASC)
    `);
    await this.db.query(`ALTER TABLE incident_messages ADD COLUMN IF NOT EXISTS audio_url TEXT`);
    await this.db.query(`ALTER TABLE incident_messages ADD COLUMN IF NOT EXISTS audio_duration_ms INTEGER`);

    // Legacy PostGIS `location` geometry column may exist with a NOT NULL
    // constraint from an older schema. No current code populates it, so relax
    // the constraint to unblock incident inserts. No-op if absent/already nullable.
    await this.db
      .query(`ALTER TABLE incidents ALTER COLUMN location DROP NOT NULL`)
      .catch(() => undefined);

    // Fix legacy UUID column types — convert incidents.id and event_id from UUID to TEXT.
    // Drop FKs where incidents is the CHILD (e.g. incidents.event_id → events.id)
    const { rows: outboundFks } = await this.db.query<{ constraint_name: string }>(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'incidents'
        AND constraint_type = 'FOREIGN KEY'
    `);
    for (const fk of outboundFks) {
      await this.db.query(`ALTER TABLE incidents DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`);
    }

    // Drop FKs where incidents is the PARENT (e.g. incident_assignments.incident_id → incidents.id)
    const { rows: inboundFks } = await this.db.query<{ constraint_name: string; table_name: string }>(`
      SELECT tc.constraint_name, tc.table_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
      JOIN information_schema.key_column_usage ccu
        ON ccu.constraint_name = rc.unique_constraint_name AND ccu.table_schema = rc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'incidents' AND ccu.column_name = 'id'
    `);
    for (const fk of inboundFks) {
      await this.db.query(`ALTER TABLE "${fk.table_name}" DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`);
    }

    // Retype the columns (TEXT→TEXT is a no-op on subsequent boots)
    await this.db.query(`ALTER TABLE incidents ALTER COLUMN id TYPE TEXT USING id::TEXT`).catch(() => {});
    await this.db.query(`ALTER TABLE incidents ALTER COLUMN event_id TYPE TEXT USING event_id::TEXT`).catch(() => {});
    // created_by may be a legacy UUID column; medics use UUID ids but the dashboard
    // (and seed data) use plain text — relax to TEXT so any author can report.
    await this.db.query(`ALTER TABLE incidents ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT`).catch(() => {});

    // Retype child columns and recreate inbound FKs
    for (const fk of inboundFks) {
      await this.db.query(
        `ALTER TABLE "${fk.table_name}" ALTER COLUMN incident_id TYPE TEXT USING incident_id::TEXT`,
      ).catch(() => {});
      await this.db.query(`
        ALTER TABLE "${fk.table_name}"
          ADD CONSTRAINT "${fk.constraint_name}"
          FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
      `).catch(() => {});
    }
    // Note: outbound FKs (incidents → events) are intentionally NOT recreated
    // because events use plain-text join codes, not UUIDs.

    // Legacy CHECK constraint may restrict status to the old set (no 'closed').
    // Drop it — status values are validated at the application layer.
    await this.db
      .query(`ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_status_check`)
      .catch(() => undefined);

    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_incidents_event ON incidents (event_id, created_at DESC)
    `);
  }

  /** Resolve a human-readable reporter name from the creator's id. */
  private async resolveReporterName(eventId: string, userId: string): Promise<string> {
    if (!userId || userId === "system") return "Dashboard";
    // App medics carry their event_medics.id as the session userId.
    const medic = await this.db.query<{ name: string }>(
      `SELECT name FROM event_medics WHERE id::text = $1 AND event_id = $2`,
      [userId, eventId],
    );
    if (medic.rows[0]?.name) return medic.rows[0].name;
    // Dashboard / admin users live in the users table.
    const user = await this.db
      .query<{ name: string }>(`SELECT name FROM users WHERE id::text = $1`, [userId])
      .catch(() => ({ rows: [] as { name: string }[] }));
    if (user.rows[0]?.name) return user.rows[0].name;
    return "Dashboard";
  }

  /**
   * Insert a system "log" entry into the incident chat (reported / dispatched /
   * arrived / …) and broadcast it like a normal message. Clients render
   * author_id "system" as a timeline divider. Best-effort — never throws.
   */
  private async systemMessage(eventId: string, incidentId: string, text: string): Promise<void> {
    try {
      const id = randomUUID();
      const now = new Date().toISOString();
      await this.db.query(
        `INSERT INTO incident_messages (id, incident_id, event_id, author_id, author_name, text, created_at)
         VALUES ($1, $2, $3, 'system', 'System', $4, $5)`,
        [id, incidentId, eventId, text, now],
      );
      const message: IncidentMessageRecord = {
        id,
        incidentId,
        eventId,
        authorId: "system",
        authorName: "System",
        text,
        createdAt: now,
      };
      await this.redisService.publish(`event:${eventId}:incidents`, {
        type: "incident.message",
        payload: message,
      });
    } catch {
      // log entries are best-effort
    }
  }

  async create(eventId: string, userId: string, input: CreateIncidentDto): Promise<IncidentRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();

    // Sequential per-event name: "Incident 1", "Incident 2", …
    const { rows: countRows } = await this.db.query<{ count: string }>(
      `SELECT count(*)::int AS count FROM incidents WHERE event_id = $1`,
      [eventId],
    );
    const sequence = Number(countRows[0]?.count ?? 0) + 1;
    const name = `Incident ${sequence}`;

    // Runners send their name in the payload (the session userId is a slug);
    // medics/dashboard resolve from the roster. Prefer an explicit runnerName.
    const reporterName = input.runnerName?.trim() || (await this.resolveReporterName(eventId, userId));

    // A category implies a default severity + a human-readable `type` label when
    // the caller didn't supply its own.
    const category = (input.category as IncidentCategory | undefined) ?? undefined;
    const severity =
      input.severity ?? (category ? INCIDENT_CATEGORY_SEVERITY[category] : null);
    const type = input.type ?? (category ? category.replace(/_/g, " ") : "other");

    const { rows } = await this.db.query<IncidentRow>(
      `INSERT INTO incidents
         (id, event_id, name, lat, lng, type, description, severity, category, accuracy, photo_url, status, created_by, reporter_name, created_at, updated_at, responders)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open', $12, $13, $14, $14, '[]')
       RETURNING *`,
      [
        id,
        eventId,
        name,
        input.lat,
        input.lng,
        type,
        input.description ?? "",
        severity,
        category ?? null,
        input.accuracy ?? null,
        input.photoUrl ?? null,
        userId,
        reporterName,
        now,
      ],
    );

    const incident = rowToRecord(rows[0]);

    await this.redisService.publish(`event:${eventId}:incidents`, {
      type: "incident.created",
      payload: incident,
    });

    void this.systemMessage(eventId, id, `🚨 Reported by ${reporterName}`);

    // Alarm: every device registered to the event (medics + dashboard) gets pinged.
    void this.notificationsService.sendToEvent(
      eventId,
      `🚨 ${incident.name}`,
      incident.type,
      // Structured fields so each device composes its own body (category +
      // distance-from-me) rather than rendering a raw payload.
      {
        incidentId: incident.id,
        eventId,
        kind: "incident_alarm",
        sound: "alarm",
        incidentName: incident.name,
        incidentType: incident.type,
        lat: incident.lat,
        lng: incident.lng,
        // Lets each device skip ringing for incidents that predate the app
        // being opened (a queued push delivered on open must not re-alarm).
        createdAt: incident.createdAt,
      },
      // Notification-payload push: the OS renders it even if the app process
      // can't be woken (data-only proved unreliable on Samsung when killed).
      // The v3 channel carries the bundled siren sound + strong vibration.
      // Skip the reporter — they shouldn't be alarmed by their own report.
      { channelId: "incident-alarm-v4", excludeUserId: userId },
    );

    return { ...incident, nearbyParamedics: [] };
  }

  async list(eventId: string, role: UserRole): Promise<IncidentRecord[]> {
    if (role === "runner" || role === "spectator") {
      return [];
    }

    const { rows } = await this.db.query<IncidentRow & { last_message_at: string | null }>(
      `SELECT i.*, m.last_message_at
         FROM incidents i
         LEFT JOIN (
           SELECT incident_id, max(created_at) AS last_message_at
             FROM incident_messages
            GROUP BY incident_id
         ) m ON m.incident_id = i.id
        WHERE i.event_id = $1
        ORDER BY i.created_at DESC`,
      [eventId],
    );

    return rows.map((r) => ({ ...rowToRecord(r), lastMessageAt: toIso(r.last_message_at) }));
  }

  /**
   * Incidents the caller reported themselves. Runners can't see the full event
   * incident list, but they need to follow the dispatch status + assigned medic
   * for their own SOS (the "SOS sent" / "track medic" screens).
   */
  async listMine(eventId: string, userId: string): Promise<IncidentRecord[]> {
    const { rows } = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE event_id = $1 AND created_by = $2 ORDER BY created_at DESC`,
      [eventId, userId],
    );
    return rows.map(rowToRecord);
  }

  async applyAction(
    eventId: string,
    incidentId: string,
    userId: string,
    action: IncidentActionDto,
  ): Promise<IncidentRecord> {
    const { rows: existing } = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE id = $1 AND event_id = $2`,
      [incidentId, eventId],
    );

    if (!existing[0]) {
      throw new NotFoundException("Incident not found");
    }

    const current = rowToRecord(existing[0]);
    let newStatus: IncidentStatus = current.status;
    let newResponders = [...current.responders];

    if (action.action === "going" && !newResponders.includes(userId)) {
      newResponders.push(userId);
      newStatus = "assigned";
    }
    if (action.action === "arrived") {
      newStatus = "in_progress";
    }
    if (action.action === "resolved") {
      newStatus = "resolved";
    }
    if (action.action === "stand_down") {
      newResponders = newResponders.filter((id) => id !== userId);
      // Revert to "open" once the last responder steps away (unless already resolved/closed).
      if (newResponders.length === 0 && newStatus === "assigned") {
        newStatus = "open";
      }
      // Stepping away also clears their destination/route so the going_to badge
      // and dashed line disappear.
      await this.clearMedicDestination(eventId, userId);
    }

    const now = new Date().toISOString();
    const { rows: updated } = await this.db.query<IncidentRow>(
      `UPDATE incidents
       SET status = $1, responders = $2::jsonb, updated_at = $3
       WHERE id = $4 AND event_id = $5
       RETURNING *`,
      [newStatus, JSON.stringify(newResponders), now, incidentId, eventId],
    );

    const incident = rowToRecord(updated[0]);

    // Timeline log entry for the chat.
    void this.resolveReporterName(eventId, userId).then((actorName) => {
      const logText =
        action.action === "going"
          ? `🚑 ${actorName} is responding`
          : action.action === "arrived"
            ? `📍 ${actorName} arrived on scene`
            : action.action === "resolved"
              ? `✅ ${actorName} marked the incident resolved`
              : action.action === "stand_down"
                ? `↩️ ${actorName} stood down`
                : action.action === "need_backup"
                  ? `🆘 ${actorName} requested backup`
                  : null;
      if (logText) void this.systemMessage(eventId, incidentId, logText);
    });

    await this.redisService.publish(`event:${eventId}:ops`, {
      type: "incident.action",
      payload: { incidentId, userId, action: action.action, status: incident.status },
    });
    // Broadcast the full record so every client refreshes the responders list.
    await this.redisService.publish(`event:${eventId}:incidents`, {
      type: "incident.updated",
      payload: { ...incident, nearbyParamedics: [] },
    });

    return incident;
  }

  async updateDetails(
    eventId: string,
    incidentId: string,
    input: UpdateIncidentDetailsDto,
  ): Promise<IncidentRecord> {
    const { rows: existing } = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE id = $1 AND event_id = $2`,
      [incidentId, eventId],
    );

    if (!existing[0]) {
      throw new NotFoundException("Incident not found");
    }

    const current = rowToRecord(existing[0]);
    const now = new Date().toISOString();

    const { rows: updated } = await this.db.query<IncidentRow>(
      `UPDATE incidents
       SET type        = COALESCE($1, type),
           description = COALESCE($2, description),
           photo_url   = COALESCE($3, photo_url),
           photo_urls  = CASE
             WHEN $3::text IS NULL OR photo_urls @> to_jsonb($3::text) THEN photo_urls
             ELSE photo_urls || jsonb_build_array($3::text)
           END,
           severity    = COALESCE($4, severity),
           status      = COALESCE($5, status),
           updated_at  = $6
       WHERE id = $7 AND event_id = $8
       RETURNING *`,
      [
        input.type ?? null,
        input.description ?? null,
        input.photoUrl ?? null,
        input.severity ?? null,
        input.status ?? null,
        now,
        incidentId,
        eventId,
      ],
    );

    const incident = rowToRecord(updated[0]);

    await this.redisService.publish(`event:${eventId}:incidents`, {
      type: "incident.updated",
      payload: { ...incident, nearbyParamedics: current.nearbyParamedics ?? [] },
    });

    return incident;
  }

  async assign(eventId: string, incidentId: string, paramedicId: string): Promise<IncidentRecord> {
    const { rows: existing } = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE id = $1 AND event_id = $2`,
      [incidentId, eventId],
    );

    if (!existing[0]) {
      throw new NotFoundException("Incident not found");
    }

    const current = rowToRecord(existing[0]);
    const newResponders = current.responders.includes(paramedicId)
      ? current.responders
      : [...current.responders, paramedicId];

    const now = new Date().toISOString();
    const { rows: updated } = await this.db.query<IncidentRow>(
      `UPDATE incidents
       SET status = 'assigned', responders = $1::jsonb, updated_at = $2
       WHERE id = $3 AND event_id = $4
       RETURNING *`,
      [JSON.stringify(newResponders), now, incidentId, eventId],
    );

    const incident = rowToRecord(updated[0]);

    await this.redisService.publish(`event:${eventId}:ops`, {
      type: "incident.assigned",
      payload: { incidentId, paramedicId, responders: incident.responders },
    });
    // Alarm the assigned medic directly — works even when their app is closed.
    void this.notificationsService.sendToUser(
      paramedicId,
      eventId,
      `🚑 Assigned: ${incident.name}`,
      incident.type,
      // Structured fields so the device composes the body (category + distance).
      {
        incidentId: incident.id,
        eventId,
        kind: "incident_assigned",
        incidentName: incident.name,
        incidentType: incident.type,
        lat: incident.lat,
        lng: incident.lng,
      },
      { channelId: "incident-alarm-v4" },
    );

    void this.resolveReporterName(eventId, paramedicId).then((medicName) => {
      void this.systemMessage(eventId, incidentId, `🚑 ${medicName} dispatched to the incident`);
    });
    // Broadcast the full record so every client refreshes the responders list.
    await this.redisService.publish(`event:${eventId}:incidents`, {
      type: "incident.updated",
      payload: { ...incident, nearbyParamedics: [] },
    });

    return incident;
  }

  async noteNearbyResponderArrivals(
    eventId: string,
    medicId: string,
    lat: number,
    lng: number,
    radiusMeters = 80,
  ): Promise<void> {
    const { rows } = await this.db.query<IncidentRow>(
      `SELECT *
       FROM incidents
       WHERE event_id = $1
         AND responders @> $2::jsonb
         AND status NOT IN ('resolved', 'closed', 'archived')`,
      [eventId, JSON.stringify([medicId])],
    );

    for (const row of rows) {
      const incident = rowToRecord(row);
      if (haversineMeters(lat, lng, incident.lat, incident.lng) > radiusMeters) continue;

      const medicName = await this.resolveReporterName(eventId, medicId);
      const logText = `📍 ${medicName} arrived on scene`;
      const existing = await this.db.query<{ id: string }>(
        `SELECT id
         FROM incident_messages
         WHERE event_id = $1
           AND incident_id = $2
           AND author_id = 'system'
           AND text = $3
         LIMIT 1`,
        [eventId, incident.id, logText],
      );
      if (existing.rows[0]) continue;

      if (incident.status !== "in_progress") {
        const now = new Date().toISOString();
        const { rows: updated } = await this.db.query<IncidentRow>(
          `UPDATE incidents
           SET status = 'in_progress', updated_at = $1
           WHERE id = $2 AND event_id = $3
           RETURNING *`,
          [now, incident.id, eventId],
        );
        const updatedIncident = rowToRecord(updated[0]);
        await this.redisService.publish(`event:${eventId}:ops`, {
          type: "incident.action",
          payload: { incidentId: incident.id, userId: medicId, action: "arrived", status: updatedIncident.status },
        });
        await this.redisService.publish(`event:${eventId}:incidents`, {
          type: "incident.updated",
          payload: { ...updatedIncident, nearbyParamedics: [] },
        });
      }

      await this.systemMessage(eventId, incident.id, logText);
    }
  }

  /** Remove a specific medic from an incident's responders. Allowed for roster
   *  coordinators (the mobile session role header says "medic" even for them,
   *  so the check is against event_medics.type), dashboard coordinators, and
   *  medics removing themselves. */
  async unassign(
    eventId: string,
    incidentId: string,
    paramedicId: string,
    caller: { userId: string; role: UserRole },
  ): Promise<IncidentRecord> {
    if (caller.role !== "coordinator" && caller.userId !== paramedicId) {
      // Coordinator status is the caller's global user role (resolved live by
      // name), not a per-event flag.
      const { rows: callerRows } = await this.db.query<{ role: string | null }>(
        `SELECT u.role
         FROM event_medics em
         LEFT JOIN users u ON u.name = em.name
         WHERE em.id::text = $1 AND em.event_id = $2`,
        [caller.userId, eventId],
      );
      if (callerRows[0]?.role !== "coordinator") {
        throw new ForbiddenException("Only coordinators can unassign other medics");
      }
    }

    const { rows: existing } = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE id = $1 AND event_id = $2`,
      [incidentId, eventId],
    );

    if (!existing[0]) {
      throw new NotFoundException("Incident not found");
    }

    const current = rowToRecord(existing[0]);
    const newResponders = current.responders.filter((id) => id !== paramedicId);
    // Mirror stand_down: an assigned incident with nobody left goes back to open.
    const newStatus: IncidentStatus =
      newResponders.length === 0 && current.status === "assigned" ? "open" : current.status;

    const now = new Date().toISOString();
    const { rows: updated } = await this.db.query<IncidentRow>(
      `UPDATE incidents
       SET status = $1, responders = $2::jsonb, updated_at = $3
       WHERE id = $4 AND event_id = $5
       RETURNING *`,
      [newStatus, JSON.stringify(newResponders), now, incidentId, eventId],
    );

    const incident = rowToRecord(updated[0]);

    // No longer assigned → stop routing them to it (clears the going_to badge +
    // dashed line).
    await this.clearMedicDestination(eventId, paramedicId);

    await this.redisService.publish(`event:${eventId}:ops`, {
      type: "incident.unassigned",
      payload: { incidentId, paramedicId, responders: incident.responders },
    });

    void this.resolveReporterName(eventId, paramedicId).then((medicName) => {
      void this.systemMessage(eventId, incidentId, `↩️ ${medicName} was unassigned`);
    });
    await this.redisService.publish(`event:${eventId}:incidents`, {
      type: "incident.updated",
      payload: { ...incident, nearbyParamedics: [] },
    });

    return incident;
  }

  /** Attach an uploaded photo to an incident (any medic, any time after report). */
  async addPhoto(eventId: string, incidentId: string, url: string): Promise<IncidentRecord> {
    const { rows: existing } = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE id = $1 AND event_id = $2`,
      [incidentId, eventId],
    );

    if (!existing[0]) {
      throw new NotFoundException("Incident not found");
    }

    const current = rowToRecord(existing[0]);
    const photoUrls = current.photoUrls.includes(url) ? current.photoUrls : [...current.photoUrls, url];

    const now = new Date().toISOString();
    const { rows: updated } = await this.db.query<IncidentRow>(
      `UPDATE incidents
       SET photo_urls = $1::jsonb,
           photo_url  = COALESCE(photo_url, $2),
           updated_at = $3
       WHERE id = $4 AND event_id = $5
       RETURNING *`,
      [JSON.stringify(photoUrls), url, now, incidentId, eventId],
    );

    const incident = rowToRecord(updated[0]);

    await this.redisService.publish(`event:${eventId}:incidents`, {
      type: "incident.updated",
      payload: { ...incident, nearbyParamedics: [] },
    });

    return incident;
  }

  // ─── Close (casualty-care handover) ────────────────────────────────────────

  async close(
    eventId: string,
    incidentId: string,
    userId: string,
    input: { vitals?: string; treatment?: string; transport?: string },
  ): Promise<IncidentRecord> {
    const { rows: existing } = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE id = $1 AND event_id = $2`,
      [incidentId, eventId],
    );
    if (!existing[0]) {
      throw new NotFoundException("Incident not found");
    }

    const now = new Date().toISOString();
    const { rows: updated } = await this.db.query<IncidentRow>(
      `UPDATE incidents
       SET status     = 'closed',
           vitals     = COALESCE($1, vitals),
           treatment  = COALESCE($2, treatment),
           transport  = COALESCE($3, transport),
           closed_by  = $4,
           closed_at  = $5,
           updated_at = $5
       WHERE id = $6 AND event_id = $7
       RETURNING *`,
      [
        input.vitals ?? null,
        input.treatment ?? null,
        input.transport ?? null,
        userId,
        now,
        incidentId,
        eventId,
      ],
    );

    const incident = rowToRecord(updated[0]);

    await this.redisService.publish(`event:${eventId}:incidents`, {
      type: "incident.updated",
      payload: { ...incident, nearbyParamedics: [] },
    });

    void this.resolveReporterName(eventId, userId).then((actorName) => {
      void this.systemMessage(eventId, incidentId, `🏁 Closed with handover by ${actorName}`);
    });

    return incident;
  }

  // ─── Chat ──────────────────────────────────────────────────────────────────

  async listMessages(eventId: string, incidentId: string): Promise<IncidentMessageRecord[]> {
    const { rows } = await this.db.query<{
      id: string;
      incident_id: string;
      event_id: string;
      author_id: string;
      author_name: string;
      text: string;
      photo_url: string | null;
      audio_url: string | null;
      audio_duration_ms: number | null;
      created_at: string;
    }>(
      `SELECT * FROM incident_messages WHERE incident_id = $1 AND event_id = $2 ORDER BY created_at ASC`,
      [incidentId, eventId],
    );
    return rows.map((r) => ({
      id: r.id,
      incidentId: r.incident_id,
      eventId: r.event_id,
      authorId: r.author_id,
      authorName: r.author_name,
      text: r.text,
      photoUrl: r.photo_url ?? undefined,
      audioUrl: r.audio_url ?? undefined,
      audioDurationMs: r.audio_duration_ms ?? undefined,
      createdAt: toIso(r.created_at) ?? new Date().toISOString(),
    }));
  }

  async addMessage(
    eventId: string,
    incidentId: string,
    authorId: string,
    input: { text: string; photoUrl?: string; audioUrl?: string; audioDurationMs?: number },
  ): Promise<IncidentMessageRecord> {
    const { rows: incidentRows } = await this.db.query<{ id: string }>(
      `SELECT id FROM incidents WHERE id = $1 AND event_id = $2`,
      [incidentId, eventId],
    );
    if (!incidentRows[0]) {
      throw new NotFoundException("Incident not found");
    }

    // Best-effort display name from the medic roster, else the raw id.
    // Cast id::text so a non-UUID author (e.g. the dashboard) doesn't error on a UUID column.
    const { rows: nameRows } = await this.db.query<{ name: string }>(
      `SELECT name FROM event_medics WHERE id::text = $1 AND event_id = $2`,
      [authorId, eventId],
    );
    const authorName = nameRows[0]?.name ?? "Dashboard";

    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db.query(
      `INSERT INTO incident_messages (id, incident_id, event_id, author_id, author_name, text, photo_url, audio_url, audio_duration_ms, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, incidentId, eventId, authorId, authorName, input.text, input.photoUrl ?? null, input.audioUrl ?? null, input.audioDurationMs ?? null, now],
    );

    const message: IncidentMessageRecord = {
      id,
      incidentId,
      eventId,
      authorId,
      authorName,
      text: input.text,
      photoUrl: input.photoUrl,
      audioUrl: input.audioUrl,
      audioDurationMs: input.audioDurationMs,
      createdAt: now,
    };

    await this.redisService.publish(`event:${eventId}:incidents`, {
      type: "incident.message",
      payload: message,
    });

    return message;
  }
}
