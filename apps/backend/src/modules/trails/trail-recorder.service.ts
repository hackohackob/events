import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DbService } from "../infra/db.service";
import { haversineMeters } from "../routing/geo";

export interface TrailSampleInput {
  eventId: string;
  medicId: string;
  lat: number;
  lng: number;
  /** ISO fix time. */
  recordedAt: string;
  speed?: number;
  heading?: number;
  accuracy?: number;
  battery?: number;
  charging?: boolean;
}

interface PendingRow extends Required<Pick<TrailSampleInput, "eventId" | "medicId" | "lat" | "lng" | "recordedAt">> {
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  battery: number | null;
  charging: boolean | null;
}

interface LastStored {
  lat: number;
  lng: number;
  atMs: number;
}

/**
 * Movement deadband. A fix closer than this to the last *stored* breadcrumb is
 * dropped — a medic holding a post at a 30s cadence would otherwise write 1440
 * near-identical rows per 12h. Sized above typical urban GPS jitter so a
 * stationary device doesn't scribble.
 */
const MIN_MOVE_M = 12;

/**
 * …but a stationary medic still gets a breadcrumb this often, so the trail has
 * a continuous spine and "they were here from 09:10 to 11:40" is provable
 * rather than inferred from a single point plus a gap.
 */
const HEARTBEAT_MS = 5 * 60_000;

/** Floor on spacing — protects the table from a device reporting at 1 Hz. */
const MIN_GAP_MS = 10_000;

/** Fixes vaguer than this are cell-tower noise; they'd bend the trail through
 *  buildings. Dropped unless nothing has been stored for a heartbeat. */
const MAX_ACCURACY_M = 150;

/** How often the buffer drains. */
const FLUSH_INTERVAL_MS = 5_000;

/** …or sooner, once this many rows are queued. */
const FLUSH_AT_ROWS = 500;

/** Safety valve: if the DB is down, stop growing the buffer without bound. */
const MAX_BUFFER_ROWS = 20_000;

/**
 * Writes medic breadcrumbs to `medic_location_history`.
 *
 * Ingestion must never slow a location ping down, so `record()` is synchronous
 * and does nothing but a distance check and an array push; rows drain on a
 * timer as a single multi-row INSERT. At a realistic 40-medic event that turns
 * ~480 individual INSERTs per minute into 12 batched ones.
 *
 * The cost of the buffer is that a hard crash loses up to `FLUSH_INTERVAL_MS`
 * of trail. That's the right trade for breadcrumbs — the live position is
 * already persisted synchronously by `medic_last_location`.
 */
@Injectable()
export class TrailRecorderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrailRecorderService.name);
  private readonly lastStored = new Map<string, LastStored>();
  private buffer: PendingRow[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private droppedRows = 0;

  constructor(private readonly db: DbService) {}

  async onModuleInit() {
    await this.ensureSchema();
    await this.ensurePartitions();
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    // Don't hold the process open just to drain breadcrumbs.
    this.timer.unref?.();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  /**
   * Queue one fix. Cheap and synchronous — safe to call from the hot path.
   * Returns true when the sample was accepted (i.e. cleared the deadband).
   */
  record(sample: TrailSampleInput): boolean {
    if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lng)) return false;

    const atMs = Date.parse(sample.recordedAt);
    if (!Number.isFinite(atMs)) return false;

    const key = `${sample.eventId}:${sample.medicId}`;
    const previous = this.lastStored.get(key);

    if (previous) {
      const elapsed = atMs - previous.atMs;
      // Out-of-order arrival (a queue flushed after a Doze freeze can deliver
      // an older fix than one already stored). Keep it — the read path sorts —
      // but don't let it move the deadband anchor backwards.
      if (elapsed <= 0) {
        this.push(sample, atMs);
        return true;
      }
      if (elapsed < MIN_GAP_MS) return false;

      const stale = elapsed >= HEARTBEAT_MS;
      if (!stale) {
        if (sample.accuracy != null && sample.accuracy > MAX_ACCURACY_M) return false;
        if (haversineMeters(previous.lat, previous.lng, sample.lat, sample.lng) < MIN_MOVE_M) return false;
      }
    }

    this.lastStored.set(key, { lat: sample.lat, lng: sample.lng, atMs });
    this.push(sample, atMs);
    return true;
  }

  private push(sample: TrailSampleInput, atMs: number): void {
    if (this.buffer.length >= MAX_BUFFER_ROWS) {
      this.droppedRows += 1;
      return;
    }
    this.buffer.push({
      eventId: sample.eventId,
      medicId: sample.medicId,
      recordedAt: new Date(atMs).toISOString(),
      lat: sample.lat,
      lng: sample.lng,
      speed: numberOrNull(sample.speed),
      heading: numberOrNull(sample.heading),
      accuracy: numberOrNull(sample.accuracy),
      battery: numberOrNull(sample.battery),
      charging: typeof sample.charging === "boolean" ? sample.charging : null,
    });
    if (this.buffer.length >= FLUSH_AT_ROWS) void this.flush();
  }

  /** Drain the buffer into one INSERT. Overlapping calls are collapsed. */
  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const rows = this.buffer;
    this.buffer = [];

    try {
      // UNNEST beats a generated VALUES list: one parse/plan regardless of how
      // many rows are in flight, and ten bind parameters instead of ten × N.
      await this.db.query(
        `INSERT INTO medic_location_history
           (event_id, medic_id, recorded_at, lat, lng, speed, heading, accuracy, battery, charging)
         SELECT * FROM UNNEST(
           $1::text[], $2::text[], $3::timestamptz[], $4::float8[], $5::float8[],
           $6::real[], $7::real[], $8::real[], $9::real[], $10::boolean[]
         )
         ON CONFLICT DO NOTHING`,
        [
          rows.map((r) => r.eventId),
          rows.map((r) => r.medicId),
          rows.map((r) => r.recordedAt),
          rows.map((r) => r.lat),
          rows.map((r) => r.lng),
          rows.map((r) => r.speed),
          rows.map((r) => r.heading),
          rows.map((r) => r.accuracy),
          rows.map((r) => r.battery),
          rows.map((r) => r.charging),
        ],
      );
      if (this.droppedRows > 0) {
        this.logger.warn(`trail buffer overflowed — dropped ${this.droppedRows} breadcrumb(s)`);
        this.droppedRows = 0;
      }
    } catch (err) {
      // Put the rows back so a transient outage doesn't punch a hole in the
      // trail — unless that would blow the buffer, in which case newest wins.
      const room = MAX_BUFFER_ROWS - this.buffer.length;
      if (room > 0) this.buffer = [...rows.slice(-room), ...this.buffer];
      this.logger.warn(`trail flush failed (${rows.length} rows requeued): ${String(err)}`);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Create the history table if it isn't there yet.
   *
   * Production does not need this: the API image's CMD runs `migrate:sql`
   * before starting, so `infra/migrations/006` has already applied. It is here
   * for the environments that never run migrations — `start:dev` goes straight
   * to ts-node, so a freshly created local database has no trail table at all,
   * and the first location ping would otherwise fail on every flush.
   *
   * Mirrors migration 006 exactly and every statement is idempotent, so the two
   * running against the same database is a no-op.
   */
  private async ensureSchema(): Promise<void> {
    const statements = [
      `CREATE TABLE IF NOT EXISTS medic_location_history (
         event_id     TEXT NOT NULL,
         medic_id     TEXT NOT NULL,
         recorded_at  TIMESTAMPTZ NOT NULL,
         lat          DOUBLE PRECISION NOT NULL,
         lng          DOUBLE PRECISION NOT NULL,
         speed        REAL,
         heading      REAL,
         accuracy     REAL,
         battery      REAL,
         charging     BOOLEAN,
         PRIMARY KEY (event_id, medic_id, recorded_at)
       ) PARTITION BY RANGE (recorded_at)`,
      `CREATE TABLE IF NOT EXISTS medic_location_history_default
         PARTITION OF medic_location_history DEFAULT`,
      `CREATE OR REPLACE FUNCTION create_monthly_medic_history_partition(target_month DATE)
       RETURNS VOID
       LANGUAGE plpgsql
       AS $fn$
       DECLARE
         partition_name TEXT := 'medic_location_history_' || to_char(target_month, 'YYYY_MM');
         start_ts TIMESTAMPTZ := date_trunc('month', target_month)::timestamptz;
         end_ts   TIMESTAMPTZ := (date_trunc('month', target_month) + INTERVAL '1 month')::timestamptz;
       BEGIN
         EXECUTE format(
           'CREATE TABLE IF NOT EXISTS %I PARTITION OF medic_location_history FOR VALUES FROM (%L) TO (%L)',
           partition_name, start_ts, end_ts
         );
       EXCEPTION
         WHEN OTHERS THEN
           RAISE NOTICE 'skipped partition %: %', partition_name, SQLERRM;
       END;
       $fn$`,
    ];
    for (const sql of statements) {
      await this.db
        .query(sql)
        .catch((err) => this.logger.warn(`trail schema init skipped: ${String(err)}`));
    }
  }

  /**
   * Keep this month's and next month's partitions present. Runs at boot, which
   * on a service restarted at least monthly is enough; the DEFAULT partition
   * catches anything that slips through so an insert can never fail.
   */
  private async ensurePartitions(): Promise<void> {
    for (const sql of [
      `SELECT create_monthly_medic_history_partition(CURRENT_DATE)`,
      `SELECT create_monthly_medic_history_partition((CURRENT_DATE + INTERVAL '1 month')::date)`,
    ]) {
      await this.db
        .query(sql)
        .catch((err) => this.logger.warn(`trail partition maintenance skipped: ${String(err)}`));
    }
  }
}

function numberOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
