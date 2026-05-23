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
  lat: number;
  lng: number;
  type: string;
  description: string;
  severity?: string;
  photoUrl?: string;
  status: IncidentStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  responders: string[];
  nearbyParamedics?: string[];
}

interface IncidentRow {
  id: string;
  event_id: string;
  lat: number;
  lng: number;
  type: string;
  description: string;
  severity: string | null;
  photo_url: string | null;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  responders: string[];
}

function rowToRecord(r: IncidentRow): IncidentRecord {
  return {
    id: r.id,
    eventId: r.event_id,
    lat: r.lat,
    lng: r.lng,
    type: r.type,
    description: r.description,
    severity: r.severity ?? undefined,
    photoUrl: r.photo_url ?? undefined,
    status: r.status as IncidentStatus,
    createdBy: r.created_by,
    createdAt: typeof r.created_at === "string" ? r.created_at : new Date(r.created_at).toISOString(),
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : new Date(r.updated_at).toISOString(),
    responders: Array.isArray(r.responders) ? r.responders : [],
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
      `ALTER TABLE incidents ADD COLUMN IF NOT EXISTS responders JSONB NOT NULL DEFAULT '[]'`,
    ];
    for (const sql of alterations) {
      await this.db.query(sql);
    }

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

    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_incidents_event ON incidents (event_id, created_at DESC)
    `);
  }

  async create(eventId: string, userId: string, input: CreateIncidentDto): Promise<IncidentRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const { rows } = await this.db.query<IncidentRow>(
      `INSERT INTO incidents
         (id, event_id, lat, lng, type, description, severity, photo_url, status, created_by, created_at, updated_at, responders)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $10, '[]')
       RETURNING *`,
      [
        id,
        eventId,
        input.lat,
        input.lng,
        input.type ?? "other",
        input.description ?? "",
        input.severity ?? null,
        input.photoUrl ?? null,
        userId,
        now,
      ],
    );

    const incident = rowToRecord(rows[0]);

    await this.redisService.publish(`event:${eventId}:incidents`, {
      type: "incident.created",
      payload: incident,
    });

    void this.notificationsService.sendToEvent(
      eventId,
      "🚨 New Incident",
      `${incident.type} at (${incident.lat.toFixed(5)}, ${incident.lng.toFixed(5)})`,
      { incidentId: incident.id, eventId },
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
           updated_at  = $4
       WHERE id = $5 AND event_id = $6
       RETURNING *`,
      [
        input.type ?? null,
        input.description ?? null,
        input.photoUrl ?? null,
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

    return incident;
  }
}
