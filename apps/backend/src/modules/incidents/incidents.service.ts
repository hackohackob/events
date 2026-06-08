import { randomUUID } from "crypto";
import { Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { IncidentStatus, UserRole } from "@events/contracts";
import { DbService } from "../infra/db.service";
import { RedisService } from "../infra/redis.service";
import { NotificationsService } from "../notifications/notifications.service";
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
  photoUrl?: string;
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
}

export interface IncidentMessageRecord {
  id: string;
  incidentId: string;
  eventId: string;
  authorId: string;
  authorName: string;
  text: string;
  photoUrl?: string;
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
  photo_url: string | null;
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
    photoUrl: r.photo_url ?? undefined,
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
  ) {}

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

    const reporterName = await this.resolveReporterName(eventId, userId);

    const { rows } = await this.db.query<IncidentRow>(
      `INSERT INTO incidents
         (id, event_id, name, lat, lng, type, description, severity, photo_url, status, created_by, reporter_name, created_at, updated_at, responders)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10, $11, $12, $12, '[]')
       RETURNING *`,
      [
        id,
        eventId,
        name,
        input.lat,
        input.lng,
        input.type ?? "other",
        input.description ?? "",
        input.severity ?? null,
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

    // Alarm: every device registered to the event (medics + dashboard) gets pinged.
    void this.notificationsService.sendToEvent(
      eventId,
      `🚨 ${incident.name}`,
      incident.description?.trim()
        ? `${incident.type} — ${incident.description}`
        : `${incident.type} reported`,
      { incidentId: incident.id, eventId, kind: "incident_alarm", sound: "alarm" },
    );

    return { ...incident, nearbyParamedics: [] };
  }

  async list(eventId: string, role: UserRole): Promise<IncidentRecord[]> {
    if (role === "runner" || role === "spectator") {
      return [];
    }

    const { rows } = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE event_id = $1 ORDER BY created_at DESC`,
      [eventId],
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
    // Broadcast the full record so every client refreshes the responders list.
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
      createdAt: toIso(r.created_at) ?? new Date().toISOString(),
    }));
  }

  async addMessage(
    eventId: string,
    incidentId: string,
    authorId: string,
    input: { text: string; photoUrl?: string },
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
      `INSERT INTO incident_messages (id, incident_id, event_id, author_id, author_name, text, photo_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, incidentId, eventId, authorId, authorName, input.text, input.photoUrl ?? null, now],
    );

    const message: IncidentMessageRecord = {
      id,
      incidentId,
      eventId,
      authorId,
      authorName,
      text: input.text,
      photoUrl: input.photoUrl,
      createdAt: now,
    };

    await this.redisService.publish(`event:${eventId}:incidents`, {
      type: "incident.message",
      payload: message,
    });

    return message;
  }
}
