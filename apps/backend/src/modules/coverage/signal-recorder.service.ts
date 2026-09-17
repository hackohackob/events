import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { SignalSample } from "@events/contracts";
import { DbService } from "../infra/db.service";
import { haversineMeters } from "../routing/geo";

export interface SignalSampleInput {
  eventId: string;
  medicId: string;
  lat: number;
  lng: number;
  /** ISO fix time. */
  recordedAt: string;
  signal: SignalSample;
}

interface PendingRow {
  eventId: string;
  medicId: string;
  recordedAt: string;
  lat: number;
  lng: number;
  bars: number | null;
  rssi: number | null;
  networkType: string | null;
  generation: string | null;
  carrier: string | null;
  latencyMs: number | null;
}

interface LastStored {
  lat: number;
  lng: number;
  atMs: number;
  bars: number | null;
}

/**
 * Movement deadband. Deliberately tighter than the trail recorder's 12 m — the
 * survey is about the ground, and a dead patch fifty metres wide is exactly the
 * thing an operator needs to see.
 */
const MIN_MOVE_M = 20;

/**
 * A stationary medic still gets sampled this often. Unlike a trail, standing
 * still is *informative* here: "this post had no data for three hours" is the
 * headline finding, and it only exists if we keep sampling a parked phone.
 */
const HEARTBEAT_MS = 60_000;

/** Floor on spacing, so a 1 Hz reporter can't flood the table. */
const MIN_GAP_MS = 20_000;

/**
 * …with one exception. A change in signal quality is the event we are here to
 * capture, so a sample whose bars differ from the last stored one bypasses the
 * distance deadband (but never the {@link MIN_GAP_MS} floor). Without this, a
 * medic holding a post through a tower outage records it a minute late.
 */
function barsChanged(previous: number | null, next: number | null): boolean {
  return previous !== next;
}

/** Fixes vaguer than this would smear the survey across the wrong streets. */
const MAX_ACCURACY_M = 200;

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_AT_ROWS = 500;
const MAX_BUFFER_ROWS = 20_000;

/**
 * Writes radio snapshots to `medic_signal_history`.
 *
 * Structured exactly like {@link TrailRecorderService}: `record()` is a
 * synchronous deadband check plus an array push, and rows drain on a timer as
 * one multi-row INSERT. Ingest is the hot path for every location ping in the
 * fleet, so nothing here may await anything.
 */
@Injectable()
export class SignalRecorderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SignalRecorderService.name);
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
    this.timer.unref?.();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  /** Queue one radio snapshot. Cheap and synchronous. */
  record(sample: SignalSampleInput, accuracy?: number): boolean {
    if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lng)) return false;

    // A report with no radio fields at all is an old app build. Storing a row
    // of nulls would dilute every average on the map with data we never
    // measured, so those are dropped rather than recorded as "unknown".
    const bars = intOrNull(sample.signal.bars, 0, 4);
    if (bars === null && !sample.signal.networkType && !sample.signal.carrier) return false;

    const atMs = Date.parse(sample.recordedAt);
    if (!Number.isFinite(atMs)) return false;

    const key = `${sample.eventId}:${sample.medicId}`;
    const previous = this.lastStored.get(key);

    if (previous) {
      const elapsed = atMs - previous.atMs;
      // Out-of-order arrival (a Doze backlog flushing). Keep the row — the read
      // path aggregates, order is irrelevant — but don't move the anchor back.
      if (elapsed <= 0) {
        this.push(sample, atMs, bars);
        return true;
      }
      if (elapsed < MIN_GAP_MS) return false;

      const stale = elapsed >= HEARTBEAT_MS;
      const interesting = barsChanged(previous.bars, bars);
      if (!stale && !interesting) {
        if (accuracy != null && accuracy > MAX_ACCURACY_M) return false;
        if (haversineMeters(previous.lat, previous.lng, sample.lat, sample.lng) < MIN_MOVE_M) return false;
      }
    }

    this.lastStored.set(key, { lat: sample.lat, lng: sample.lng, atMs, bars });
    this.push(sample, atMs, bars);
    return true;
  }

  /**
   * Queue a reading the device buffered while it was offline.
   *
   * Skips the deadband entirely: the app already applied the same thinning
   * before it stored the sample, and re-applying it here would be wrong twice
   * over. A backlog arrives with timestamps OLDER than the live position we
   * have already recorded for this medic, so the elapsed-time checks would
   * either reject every row or corrupt the deadband anchor for the live feed
   * that follows. Exact re-sends are harmless — the primary key drops them.
   */
  recordBackfill(sample: SignalSampleInput): boolean {
    if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lng)) return false;
    const atMs = Date.parse(sample.recordedAt);
    if (!Number.isFinite(atMs)) return false;

    const bars = intOrNull(sample.signal.bars, 0, 4);
    if (bars === null && !sample.signal.networkType && !sample.signal.carrier) return false;

    this.push(sample, atMs, bars);
    return true;
  }

  private push(sample: SignalSampleInput, atMs: number, bars: number | null): void {
    if (this.buffer.length >= MAX_BUFFER_ROWS) {
      this.droppedRows += 1;
      return;
    }
    const { signal } = sample;
    this.buffer.push({
      eventId: sample.eventId,
      medicId: sample.medicId,
      recordedAt: new Date(atMs).toISOString(),
      lat: sample.lat,
      lng: sample.lng,
      bars,
      // Real dBm is negative and never below -140; anything outside that is a
      // sentinel from a misbehaving probe, not a reading.
      rssi: intOrNull(signal.rssi, -140, 0),
      networkType: textOrNull(signal.networkType),
      generation: textOrNull(signal.generation),
      carrier: textOrNull(signal.carrier, 64),
      latencyMs: intOrNull(signal.latencyMs, 0, 120_000),
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
      await this.db.query(
        `INSERT INTO medic_signal_history
           (event_id, medic_id, recorded_at, lat, lng, bars, rssi, network_type, generation, carrier, latency_ms)
         SELECT * FROM UNNEST(
           $1::text[], $2::text[], $3::timestamptz[], $4::float8[], $5::float8[],
           $6::smallint[], $7::smallint[], $8::text[], $9::text[], $10::text[], $11::int[]
         )
         ON CONFLICT DO NOTHING`,
        [
          rows.map((r) => r.eventId),
          rows.map((r) => r.medicId),
          rows.map((r) => r.recordedAt),
          rows.map((r) => r.lat),
          rows.map((r) => r.lng),
          rows.map((r) => r.bars),
          rows.map((r) => r.rssi),
          rows.map((r) => r.networkType),
          rows.map((r) => r.generation),
          rows.map((r) => r.carrier),
          rows.map((r) => r.latencyMs),
        ],
      );
      if (this.droppedRows > 0) {
        this.logger.warn(`signal buffer overflowed — dropped ${this.droppedRows} sample(s)`);
        this.droppedRows = 0;
      }
    } catch (err) {
      const room = MAX_BUFFER_ROWS - this.buffer.length;
      if (room > 0) this.buffer = [...rows.slice(-room), ...this.buffer];
      this.logger.warn(`signal flush failed (${rows.length} rows requeued): ${String(err)}`);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Create the table if it isn't there yet. Production applies
   * `infra/migrations/007` before boot; this is for `start:dev`, which goes
   * straight to ts-node against a database that may never have been migrated.
   * Mirrors 007 exactly and every statement is idempotent.
   */
  private async ensureSchema(): Promise<void> {
    const statements = [
      `CREATE TABLE IF NOT EXISTS medic_signal_history (
         event_id     TEXT NOT NULL,
         medic_id     TEXT NOT NULL,
         recorded_at  TIMESTAMPTZ NOT NULL,
         lat          DOUBLE PRECISION NOT NULL,
         lng          DOUBLE PRECISION NOT NULL,
         bars         SMALLINT,
         rssi         SMALLINT,
         network_type TEXT,
         generation   TEXT,
         carrier      TEXT,
         latency_ms   INTEGER,
         PRIMARY KEY (event_id, medic_id, recorded_at)
       ) PARTITION BY RANGE (recorded_at)`,
      `CREATE TABLE IF NOT EXISTS medic_signal_history_default
         PARTITION OF medic_signal_history DEFAULT`,
      `CREATE INDEX IF NOT EXISTS medic_signal_history_geo_idx
         ON medic_signal_history (recorded_at, lat, lng)`,
      `CREATE OR REPLACE FUNCTION create_monthly_medic_signal_partition(target_month DATE)
       RETURNS VOID
       LANGUAGE plpgsql
       AS $fn$
       DECLARE
         partition_name TEXT := 'medic_signal_history_' || to_char(target_month, 'YYYY_MM');
         start_ts TIMESTAMPTZ := date_trunc('month', target_month)::timestamptz;
         end_ts   TIMESTAMPTZ := (date_trunc('month', target_month) + INTERVAL '1 month')::timestamptz;
       BEGIN
         EXECUTE format(
           'CREATE TABLE IF NOT EXISTS %I PARTITION OF medic_signal_history FOR VALUES FROM (%L) TO (%L)',
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
        .catch((err) => this.logger.warn(`signal schema init skipped: ${String(err)}`));
    }
  }

  private async ensurePartitions(): Promise<void> {
    for (const sql of [
      `SELECT create_monthly_medic_signal_partition(CURRENT_DATE)`,
      `SELECT create_monthly_medic_signal_partition((CURRENT_DATE + INTERVAL '1 month')::date)`,
    ]) {
      await this.db
        .query(sql)
        .catch((err) => this.logger.warn(`signal partition maintenance skipped: ${String(err)}`));
    }
  }
}

function intOrNull(value: number | undefined, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

function textOrNull(value: string | undefined, maxLength = 32): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}
