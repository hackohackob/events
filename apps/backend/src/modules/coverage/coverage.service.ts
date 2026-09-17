import { Injectable } from "@nestjs/common";
import {
  COVERAGE_CELL_SIZES,
  COVERAGE_MAX_CELLS,
  CoverageCarrierStat,
  CoverageCell,
  CoverageDeadZone,
  CoverageEventStat,
  CoverageFacets,
  CoverageGridResponse,
  CoverageSummary,
  SIGNAL_WEAK_BARS,
  SignalGeneration,
} from "@events/contracts";
import { DbService } from "../infra/db.service";
import { RedisService } from "../infra/redis.service";

/** Geographic window a grid request covers. */
export interface CoverageBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface CoverageQuery {
  from: Date;
  to: Date;
  bounds?: CoverageBounds;
  eventIds?: string[];
  carriers?: string[];
  generations?: string[];
}

export interface CoverageGridQuery extends CoverageQuery {
  cellSize: number;
}

/**
 * Coverage reads are pure aggregates over immutable history, and the dashboard
 * re-issues them on every pan. A short cache makes panning free without the map
 * ever feeling stale — new samples land within a minute either way.
 */
const CACHE_TTL_SECONDS = 45;

/** Facets change far more slowly than the grid — they summarise whole events. */
const FACETS_CACHE_TTL_SECONDS = 5 * 60;

/** How many dead zones the list returns. Enough to act on, not a data dump. */
const DEAD_ZONE_LIMIT = 50;

/** Dead-zone clustering resolution, in degrees (~220 m). Fine enough to point
 *  at a valley, coarse enough that one lost minute isn't its own "zone". */
const DEAD_ZONE_CELL = 0.002;

/**
 * Evidence bar before a spot is called dead. A medic walking through a hole
 * leaves one or two readings in a cell — not enough to distinguish real
 * no-service ground from a phone that was mid-handover. A genuine hole gets
 * sampled repeatedly, because anyone standing in one keeps reporting from it.
 */
const DEAD_ZONE_MIN_SAMPLES = 3;

interface GridRow {
  gy: string | number;
  gx: string | number;
  mean_bars: string | number;
  worst_bars: number;
  samples: string | number;
  dead: string | number;
  latency_ms: string | number | null;
  generation: string | null;
  last_seen_at: Date | string;
  carriers: string[] | null;
}

interface SummaryRow {
  samples: string | number;
  mean_bars: string | number | null;
  first_seen_at: Date | string | null;
  last_seen_at: Date | string | null;
}

/**
 * Read side of the signal survey.
 *
 * Everything is aggregated in Postgres and only aggregates cross the wire: a
 * year of fleet telemetry is millions of rows, and the map only ever draws tens
 * of thousands of cells. The grid resolution is a parameter rather than a fixed
 * geohash so the client can trade detail for area as the operator zooms.
 */
@Injectable()
export class CoverageService {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
  ) {}

  /** Aggregated survey grid for the requested window and box. */
  async getGrid(query: CoverageGridQuery): Promise<CoverageGridResponse> {
    const cellSize = normaliseCellSize(query.cellSize);
    const cacheKey = `coverage:grid:${cellSize}:${fingerprint(query)}`;
    const cached = await this.redis.getJson<CoverageGridResponse>(cacheKey);
    if (cached) return cached;

    const { where, params } = this.buildFilter(query);
    // `bars` is the metric the whole map is built on — a row without it (an old
    // app build that reported only a carrier) would drag every average toward
    // zero, so the grid reads only measured rows.
    const filtered = `${where} AND bars IS NOT NULL`;
    const cellParam = `$${params.length + 1}`;
    const limitParam = `$${params.length + 2}`;

    const sql = `
      WITH s AS (
        SELECT lat, lng, bars, carrier, generation, latency_ms, recorded_at
          FROM medic_signal_history
         WHERE ${filtered}
      ),
      per_carrier AS (
        SELECT floor(lat / ${cellParam}) AS gy,
               floor(lng / ${cellParam}) AS gx,
               carrier,
               count(*) AS n
          FROM s
         WHERE carrier IS NOT NULL
         GROUP BY 1, 2, 3
      ),
      cells AS (
        SELECT floor(lat / ${cellParam}) AS gy,
               floor(lng / ${cellParam}) AS gx,
               avg(bars)::float8 AS mean_bars,
               min(bars) AS worst_bars,
               count(*) AS samples,
               count(*) FILTER (WHERE bars = 0) AS dead,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS latency_ms,
               mode() WITHIN GROUP (ORDER BY generation) AS generation,
               max(recorded_at) AS last_seen_at
          FROM s
         GROUP BY 1, 2
      )
      SELECT c.*,
             (SELECT array_agg(pc.carrier ORDER BY pc.n DESC)
                FROM per_carrier pc
               WHERE pc.gy = c.gy AND pc.gx = c.gx) AS carriers
        FROM cells c
       ORDER BY c.samples DESC
       LIMIT ${limitParam}`;

    // One row over the cap tells us the grid was clipped without a second
    // COUNT over the whole survey.
    const { rows } = await this.db.query<GridRow>(sql, [...params, cellSize, COVERAGE_MAX_CELLS + 1]);
    const truncated = rows.length > COVERAGE_MAX_CELLS;
    const kept = truncated ? rows.slice(0, COVERAGE_MAX_CELLS) : rows;

    const cells: CoverageCell[] = kept.map((row) => {
      const samples = num(row.samples);
      const dead = num(row.dead);
      return {
        // Cell centre, so a dot drawn at these coordinates sits in the middle
        // of the square it represents rather than on its corner.
        lat: round6((num(row.gy) + 0.5) * cellSize),
        lng: round6((num(row.gx) + 0.5) * cellSize),
        bars: round2(num(row.mean_bars)),
        worstBars: row.worst_bars ?? 0,
        samples,
        deadRatio: samples > 0 ? round3(dead / samples) : 0,
        carriers: row.carriers ?? [],
        latencyMs: row.latency_ms == null ? undefined : Math.round(num(row.latency_ms)),
        generation: (row.generation as SignalGeneration | null) ?? undefined,
        lastSeenAt: iso(row.last_seen_at),
      };
    });

    const response: CoverageGridResponse = {
      cellSize,
      cells,
      // Summary spans every matching sample, not only the cells that survived
      // the cap — otherwise a truncated grid would also report a wrong mean.
      summary: await this.getSummary(query, cells),
      truncated,
    };
    await this.redis.setJson(cacheKey, response, CACHE_TTL_SECONDS);
    return response;
  }

  /** Carriers, events and radio classes present in the window — the filters. */
  async getFacets(query: CoverageQuery): Promise<CoverageFacets> {
    const cacheKey = `coverage:facets:${fingerprint(query)}`;
    const cached = await this.redis.getJson<CoverageFacets>(cacheKey);
    if (cached) return cached;

    const { where, params } = this.buildFilter(query);

    const [carriers, events, generations, summary] = await Promise.all([
      this.db.query<{ carrier: string; samples: string; mean_bars: string; dead: string }>(
        `SELECT carrier,
                count(*) AS samples,
                avg(bars)::float8 AS mean_bars,
                count(*) FILTER (WHERE bars = 0) AS dead
           FROM medic_signal_history
          WHERE ${where} AND carrier IS NOT NULL AND bars IS NOT NULL
          GROUP BY carrier
          ORDER BY samples DESC
          LIMIT 40`,
        params,
      ),
      this.db.query<{
        event_id: string;
        samples: string;
        mean_bars: string;
        first_seen_at: Date;
        last_seen_at: Date;
      }>(
        // Event *names* are not resolved here at all — see CoverageEventStat.
        // Joining the `events` table would be wrong twice over: it is not where
        // the app keeps its event list, and reaching the real store would pull
        // EventsModule into this module's graph.
        `SELECT event_id,
                count(*) AS samples,
                avg(bars)::float8 AS mean_bars,
                min(recorded_at) AS first_seen_at,
                max(recorded_at) AS last_seen_at
           FROM medic_signal_history
          WHERE ${where} AND bars IS NOT NULL
          GROUP BY event_id
          ORDER BY samples DESC
          LIMIT 60`,
        params,
      ),
      this.db.query<{ generation: string; samples: string }>(
        `SELECT generation, count(*) AS samples
           FROM medic_signal_history
          WHERE ${where} AND generation IS NOT NULL AND bars IS NOT NULL
          GROUP BY generation
          ORDER BY samples DESC`,
        params,
      ),
      this.getSummary(query),
    ]);

    const facets: CoverageFacets = {
      carriers: carriers.rows.map(
        (r): CoverageCarrierStat => ({
          carrier: r.carrier,
          samples: num(r.samples),
          meanBars: round2(num(r.mean_bars)),
          deadRatio: num(r.samples) > 0 ? round3(num(r.dead) / num(r.samples)) : 0,
        }),
      ),
      events: events.rows.map(
        (r): CoverageEventStat => ({
          eventId: r.event_id,
          samples: num(r.samples),
          meanBars: round2(num(r.mean_bars)),
          firstSeenAt: iso(r.first_seen_at),
          lastSeenAt: iso(r.last_seen_at),
        }),
      ),
      generations: generations.rows.map((r) => ({
        generation: r.generation as SignalGeneration,
        samples: num(r.samples),
      })),
      summary,
    };
    await this.redis.setJson(cacheKey, facets, FACETS_CACHE_TTL_SECONDS);
    return facets;
  }

  /**
   * Places where phones had nothing. Only cells whose every sample was dead
   * qualify — a spot that works four times in five is a weak cell, not a hole,
   * and mixing the two would bury the real black spots.
   */
  async getDeadZones(query: CoverageQuery): Promise<CoverageDeadZone[]> {
    const cacheKey = `coverage:dead:${fingerprint(query)}`;
    const cached = await this.redis.getJson<CoverageDeadZone[]>(cacheKey);
    if (cached) return cached;

    const { where, params } = this.buildFilter(query);
    const cellParam = `$${params.length + 1}`;
    const minSamplesParam = `$${params.length + 2}`;
    const limitParam = `$${params.length + 3}`;

    const { rows } = await this.db.query<{
      gy: string;
      gx: string;
      samples: string;
      medics: string;
      carriers: string[] | null;
      last_seen_at: Date;
    }>(
      `SELECT floor(lat / ${cellParam}) AS gy,
              floor(lng / ${cellParam}) AS gx,
              count(*) AS samples,
              count(DISTINCT medic_id) AS medics,
              array_agg(DISTINCT carrier) FILTER (WHERE carrier IS NOT NULL) AS carriers,
              max(recorded_at) AS last_seen_at
         FROM medic_signal_history
        WHERE ${where} AND bars IS NOT NULL
        GROUP BY 1, 2
       HAVING max(bars) = 0 AND count(*) >= ${minSamplesParam}
        -- Distinct medics first: five people losing signal in the same square
        -- is a property of the ground, whereas fifty readings from one medic
        -- may only mean one handset having a bad day.
        ORDER BY count(DISTINCT medic_id) DESC, count(*) DESC
        LIMIT ${limitParam}`,
      [...params, DEAD_ZONE_CELL, DEAD_ZONE_MIN_SAMPLES, DEAD_ZONE_LIMIT],
    );

    const zones = rows.map(
      (r): CoverageDeadZone => ({
        lat: round6((num(r.gy) + 0.5) * DEAD_ZONE_CELL),
        lng: round6((num(r.gx) + 0.5) * DEAD_ZONE_CELL),
        samples: num(r.samples),
        medics: num(r.medics),
        carriers: r.carriers ?? [],
        lastSeenAt: iso(r.last_seen_at),
      }),
    );
    await this.redis.setJson(cacheKey, zones, CACHE_TTL_SECONDS);
    return zones;
  }

  /**
   * Totals over every matching sample. `cells`, when given, supplies the cell
   * counts — they're already computed and re-deriving them would mean grouping
   * the same rows twice.
   */
  private async getSummary(query: CoverageQuery, cells?: CoverageCell[]): Promise<CoverageSummary> {
    const { where, params } = this.buildFilter(query);
    const { rows } = await this.db.query<SummaryRow>(
      `SELECT count(*) AS samples,
              avg(bars)::float8 AS mean_bars,
              min(recorded_at) AS first_seen_at,
              max(recorded_at) AS last_seen_at
         FROM medic_signal_history
        WHERE ${where} AND bars IS NOT NULL`,
      params,
    );
    const row = rows[0];
    return {
      samples: row ? num(row.samples) : 0,
      cells: cells?.length ?? 0,
      meanBars: row?.mean_bars == null ? 0 : round2(num(row.mean_bars)),
      weakCells: cells ? cells.filter((c) => c.bars <= SIGNAL_WEAK_BARS).length : 0,
      deadCells: cells ? cells.filter((c) => c.deadRatio >= 1).length : 0,
      firstSeenAt: row?.first_seen_at ? iso(row.first_seen_at) : undefined,
      lastSeenAt: row?.last_seen_at ? iso(row.last_seen_at) : undefined,
    };
  }

  /**
   * Shared WHERE clause. Every filter is a bound parameter — the only values
   * ever interpolated into these queries are numbers this module produced.
   */
  private buildFilter(query: CoverageQuery): { where: string; params: unknown[] } {
    const clauses: string[] = ["recorded_at >= $1", "recorded_at < $2"];
    const params: unknown[] = [query.from.toISOString(), query.to.toISOString()];

    if (query.bounds) {
      const { south, west, north, east } = query.bounds;
      params.push(south, north, west, east);
      clauses.push(`lat BETWEEN $${params.length - 3} AND $${params.length - 2}`);
      clauses.push(`lng BETWEEN $${params.length - 1} AND $${params.length}`);
    }
    if (query.eventIds?.length) {
      params.push(query.eventIds);
      clauses.push(`event_id = ANY($${params.length}::text[])`);
    }
    if (query.carriers?.length) {
      params.push(query.carriers);
      clauses.push(`carrier = ANY($${params.length}::text[])`);
    }
    if (query.generations?.length) {
      params.push(query.generations);
      clauses.push(`generation = ANY($${params.length}::text[])`);
    }
    return { where: clauses.join(" AND "), params };
  }
}

function normaliseCellSize(requested: number): number {
  if (!Number.isFinite(requested)) return COVERAGE_CELL_SIZES[1];
  // Snap to the published ladder: an arbitrary size would make the Redis key
  // space unbounded and every pan a cache miss.
  let best = COVERAGE_CELL_SIZES[0] as number;
  let bestDelta = Infinity;
  for (const size of COVERAGE_CELL_SIZES) {
    const delta = Math.abs(size - requested);
    if (delta < bestDelta) {
      best = size;
      bestDelta = delta;
    }
  }
  return best;
}

/** Stable cache key for a filter set. */
function fingerprint(query: CoverageQuery): string {
  const bounds = query.bounds
    ? [query.bounds.south, query.bounds.west, query.bounds.north, query.bounds.east]
        .map((v) => v.toFixed(3))
        .join(",")
    : "world";
  return [
    query.from.toISOString(),
    query.to.toISOString(),
    bounds,
    [...(query.eventIds ?? [])].sort().join("|") || "-",
    [...(query.carriers ?? [])].sort().join("|") || "-",
    [...(query.generations ?? [])].sort().join("|") || "-",
  ].join("~");
}

/** pg returns bigint/numeric aggregates as strings to avoid precision loss. */
function num(value: string | number | null): number {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
