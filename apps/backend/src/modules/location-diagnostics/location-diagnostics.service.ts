import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  DEFAULT_LOCATION_TUNING,
  LocationDiagEntry,
  LocationDiagRecord,
  LocationDiagUpload,
  LocationTuning,
} from "@events/contracts";
import { DbService } from "../infra/db.service";
import { NotificationsService } from "../notifications/notifications.service";

/** Diagnostics are for chasing a problem this week, not a record. */
const RETENTION_DAYS = 14;
const SWEEP_INTERVAL_MS = 6 * 60 * 60_000;
/** One upload can't flood the table, whatever an old or buggy build sends. */
const MAX_ENTRIES_PER_UPLOAD = 100;
const MAX_MESSAGE_CHARS = 500;
const MAX_DATA_CHARS = 4_000;

/** Bounds every knob so a typo on the dashboard can't strand the fleet. */
const TUNING_LIMITS: Record<string, [number, number]> = {
  inaccurateThresholdM: [10, 5_000],
  retryTimeoutSec: [5, 120],
  retryTargetAccuracyM: [5, 500],
  retryCooldownSec: [30, 3_600],
  baselineSampleMin: [0, 24 * 60],
};

export interface MedicDiagSummary {
  medicId: string;
  name: string | null;
  lastFixAt: string | null;
  lastAccuracy: number | null;
  battery: number | null;
  status: string | null;
  platform: string | null;
  appVersion: string | null;
  device: string | null;
  lastDiagAt: string | null;
  inaccurate6h: number;
  refineOk6h: number;
  refineFail6h: number;
}

@Injectable()
export class LocationDiagnosticsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LocationDiagnosticsService.name);
  private tuning: LocationTuning = { ...DEFAULT_LOCATION_TUNING };
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
    await this.loadTuning();
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
    void this.sweep();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ─── Tuning ────────────────────────────────────────────────────────────────

  /** Cached — read on every location POST, so never a query. */
  getTuning(): LocationTuning {
    return this.tuning;
  }

  async updateTuning(patch: Partial<LocationTuning>): Promise<LocationTuning> {
    const next: LocationTuning = { ...this.tuning };
    for (const key of Object.keys(DEFAULT_LOCATION_TUNING) as (keyof LocationTuning)[]) {
      if (key === "version" || key === "updatedAt" || !(key in patch)) continue;
      const value = patch[key];
      const fallback = DEFAULT_LOCATION_TUNING[key];
      if (typeof fallback === "boolean") {
        if (typeof value === "boolean") (next as any)[key] = value;
      } else if (typeof fallback === "number") {
        const n = Number(value);
        if (!Number.isFinite(n)) continue;
        const [min, max] = TUNING_LIMITS[key] ?? [-Infinity, Infinity];
        (next as any)[key] = Math.round(Math.min(max, Math.max(min, n)));
      }
    }
    next.version = (this.tuning.version ?? 0) + 1;
    next.updatedAt = new Date().toISOString();
    await this.db.query(
      `INSERT INTO location_tuning (scope, settings, updated_at) VALUES ('global', $1, now())
       ON CONFLICT (scope) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`,
      [JSON.stringify(next)],
    );
    this.tuning = next;
    this.logger.log(`Location tuning saved (v${next.version})`);
    return next;
  }

  private async loadTuning(): Promise<void> {
    try {
      const { rows } = await this.db.query<{ settings: Partial<LocationTuning> }>(
        `SELECT settings FROM location_tuning WHERE scope = 'global'`,
      );
      if (rows[0]) this.tuning = { ...DEFAULT_LOCATION_TUNING, ...rows[0].settings };
    } catch (err) {
      this.logger.warn(`location tuning load failed, using defaults: ${String(err)}`);
    }
  }

  // ─── Diagnostics ───────────────────────────────────────────────────────────

  async ingest(eventId: string, upload: LocationDiagUpload): Promise<{ stored: number }> {
    const entries = (Array.isArray(upload.entries) ? upload.entries : [])
      .slice(-MAX_ENTRIES_PER_UPLOAD)
      .filter((e): e is LocationDiagEntry => !!e && typeof e.message === "string" && typeof e.kind === "string");
    if (!upload.medicId || entries.length === 0) return { stored: 0 };

    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const at = (v: string) => {
      const t = Date.parse(v);
      return Number.isFinite(t) && t <= Date.now() + 60_000 ? new Date(t).toISOString() : new Date().toISOString();
    };
    const data = (v: unknown) => {
      if (v == null) return null;
      const s = JSON.stringify(v);
      return s.length > MAX_DATA_CHARS ? JSON.stringify({ truncated: s.slice(0, MAX_DATA_CHARS) }) : s;
    };

    await this.db.query(
      `INSERT INTO location_diagnostics
         (event_id, medic_id, name, platform, app_version, device, at, kind, level, message, accuracy, lat, lng, data)
       SELECT $1, $2, $3, $4, $5, $6, * FROM UNNEST(
         $7::timestamptz[], $8::text[], $9::text[], $10::text[], $11::real[], $12::float8[], $13::float8[], $14::jsonb[]
       )`,
      [
        eventId,
        upload.medicId,
        upload.name?.slice(0, 120) ?? null,
        upload.platform?.slice(0, 40) ?? null,
        upload.appVersion?.slice(0, 40) ?? null,
        upload.device?.slice(0, 120) ?? null,
        entries.map((e) => at(e.at)),
        entries.map((e) => e.kind.slice(0, 40)),
        entries.map((e) => (e.level === "warn" || e.level === "error" ? e.level : "info")),
        entries.map((e) => e.message.slice(0, MAX_MESSAGE_CHARS)),
        entries.map((e) => num(e.accuracy)),
        entries.map((e) => num(e.lat)),
        entries.map((e) => num(e.lng)),
        entries.map((e) => data(e.data)),
      ],
    );
    return { stored: entries.length };
  }

  async list(params: {
    eventId: string;
    medicId?: string;
    kind?: string;
    level?: string;
    before?: string;
    limit?: number;
  }): Promise<LocationDiagRecord[]> {
    const where = ["event_id = $1"];
    const values: unknown[] = [params.eventId];
    if (params.medicId) where.push(`medic_id = $${values.push(params.medicId)}`);
    if (params.kind) where.push(`kind = $${values.push(params.kind)}`);
    if (params.level) where.push(`level = $${values.push(params.level)}`);
    if (params.before && Number.isFinite(Date.parse(params.before))) where.push(`at < $${values.push(params.before)}`);
    const limit = Math.min(Math.max(params.limit ?? 200, 1), 1_000);

    const { rows } = await this.db.query<any>(
      `SELECT id::text, event_id, medic_id, name, platform, app_version, device, at, received_at,
              kind, level, message, accuracy, lat, lng, data
         FROM location_diagnostics
        WHERE ${where.join(" AND ")}
        ORDER BY at DESC
        LIMIT ${limit}`,
      values,
    );
    return rows.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      medicId: r.medic_id,
      name: r.name,
      platform: r.platform,
      appVersion: r.app_version,
      device: r.device,
      at: new Date(r.at).toISOString(),
      receivedAt: new Date(r.received_at).toISOString(),
      kind: r.kind,
      level: r.level,
      message: r.message,
      accuracy: r.accuracy,
      lat: r.lat,
      lng: r.lng,
      data: r.data ?? undefined,
    }));
  }

  /** One row per medic on the event: live position quality + recent diagnostics. */
  async summary(eventId: string): Promise<MedicDiagSummary[]> {
    const { rows } = await this.db.query<any>(
      `WITH recent AS (
         SELECT medic_id,
                COUNT(*) FILTER (WHERE kind = 'inaccurate_fix')                  AS inaccurate,
                COUNT(*) FILTER (WHERE kind = 'refine' AND level = 'info')       AS refine_ok,
                COUNT(*) FILTER (WHERE kind = 'refine' AND level <> 'info')      AS refine_fail
           FROM location_diagnostics
          WHERE event_id = $1 AND at > now() - interval '6 hours'
          GROUP BY medic_id
       ),
       latest AS (
         SELECT DISTINCT ON (medic_id) medic_id, name, platform, app_version, device, at
           FROM location_diagnostics
          WHERE event_id = $1
          ORDER BY medic_id, at DESC
       )
       SELECT COALESCE(l.medic_id, d.medic_id)         AS medic_id,
              COALESCE(l.name, d.name)                 AS name,
              l.recorded_at, l.accuracy, l.battery, l.status,
              d.platform, d.app_version, d.device, d.at AS last_diag_at,
              COALESCE(r.inaccurate, 0)  AS inaccurate,
              COALESCE(r.refine_ok, 0)   AS refine_ok,
              COALESCE(r.refine_fail, 0) AS refine_fail
         FROM (SELECT * FROM medic_last_location WHERE event_id = $1) l
         FULL OUTER JOIN latest d ON d.medic_id = l.medic_id
         LEFT JOIN recent r ON r.medic_id = COALESCE(l.medic_id, d.medic_id)
        ORDER BY 2 NULLS LAST`,
      [eventId],
    );
    return rows.map((r) => ({
      medicId: r.medic_id,
      name: r.name,
      lastFixAt: r.recorded_at ? new Date(r.recorded_at).toISOString() : null,
      lastAccuracy: r.accuracy,
      battery: r.battery,
      status: r.status,
      platform: r.platform,
      appVersion: r.app_version,
      device: r.device,
      lastDiagAt: r.last_diag_at ? new Date(r.last_diag_at).toISOString() : null,
      inaccurate6h: Number(r.inaccurate),
      refineOk6h: Number(r.refine_ok),
      refineFail6h: Number(r.refine_fail),
    }));
  }

  // ─── Remote requests ───────────────────────────────────────────────────────

  /**
   * Ask one medic's phone (or every medic on the event) for a fresh precise
   * fix, via the same silent push that wakes a suspended app for the silence
   * watchdog. Nothing is shown on the phone. Returns how many devices were hit.
   */
  async requestPreciseFix(eventId: string, medicId?: string): Promise<{ medics: number; devices: number }> {
    const medicIds = medicId
      ? [medicId]
      : (
          await this.db.query<{ medic_id: string }>(
            `SELECT medic_id::text AS medic_id FROM medic_last_location
              WHERE event_id = $1 AND recorded_at > now() - interval '24 hours'`,
            [eventId],
          )
        ).rows.map((r) => r.medic_id);
    let devices = 0;
    for (const id of medicIds) {
      // Sent as a `location_ping` with a flag rather than a kind of its own:
      // builds that predate this treat an unknown kind as an incident push and
      // would sound the siren. They handle location_ping (report + rebuild
      // tracking), which is the right fallback anyway.
      devices += await this.notifications.sendSilentToUser(id, eventId, {
        kind: "location_ping",
        precise: "1",
        eventId,
        medicId: id,
        sentAt: new Date().toISOString(),
      }, { urgent: true });
    }
    this.logger.log(`Precise-fix request → ${medicIds.length} medic(s), ${devices} device(s) on ${eventId}`);
    return { medics: medicIds.length, devices };
  }

  // ─── Housekeeping ──────────────────────────────────────────────────────────

  private async sweep(): Promise<void> {
    await this.db
      .query(`DELETE FROM location_diagnostics WHERE received_at < now() - ($1::int * interval '1 day')`, [RETENTION_DAYS])
      .catch((err) => this.logger.warn(`diagnostics sweep failed: ${String(err)}`));
  }

  /**
   * Same reason as TrailRecorderService.ensureSchema: `start:dev` never runs
   * migrations. Mirrors migration 008 exactly; every statement is idempotent.
   */
  private async ensureSchema(): Promise<void> {
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS location_diagnostics (
         id BIGSERIAL PRIMARY KEY, event_id TEXT NOT NULL, medic_id TEXT NOT NULL, name TEXT,
         platform TEXT, app_version TEXT, device TEXT, at TIMESTAMPTZ NOT NULL,
         received_at TIMESTAMPTZ NOT NULL DEFAULT now(), kind TEXT NOT NULL, level TEXT NOT NULL,
         message TEXT NOT NULL, accuracy REAL, lat DOUBLE PRECISION, lng DOUBLE PRECISION, data JSONB
       )`,
      `CREATE INDEX IF NOT EXISTS location_diagnostics_event_at ON location_diagnostics (event_id, at DESC)`,
      `CREATE TABLE IF NOT EXISTS location_tuning (
         scope TEXT PRIMARY KEY, settings JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    ]) {
      await this.db.query(sql).catch((err) => this.logger.warn(`diagnostics schema init skipped: ${String(err)}`));
    }
  }
}
