import { Injectable } from "@nestjs/common";
import {
  MedicTrail,
  TrailBundle,
  TrailDwell,
  TrailSamples,
  TrailStats,
  TRAIL_MAX_HOURS,
  TRAIL_OUTAGE_GAP_MS,
  TrailWindowMode,
  VehicleType,
} from "@events/contracts";
import { DbService } from "../infra/db.service";
import { RedisService } from "../infra/redis.service";
import { EventsService } from "../events/events.service";
import { haversineMeters } from "../routing/geo";

interface HistoryRow {
  recorded_at: string | Date;
  lat: number;
  lng: number;
  speed: number | null;
  battery: number | null;
}

interface RawPoint {
  t: number;
  lat: number;
  lng: number;
  spd: number | null;
  bat: number | null;
}

/** Samples returned to a client after decimation. Enough to draw a 12h trail
 *  at full zoom without handing a phone a five-figure coordinate array. */
const DEFAULT_MAX_POINTS = 1200;
const MAX_POINTS_CEILING = 4000;

/** Starting Douglas–Peucker tolerance. Below GPS noise, so a first pass over a
 *  trail that's already sparse changes nothing. */
const SIMPLIFY_BASE_EPSILON_M = 6;

/** Doubling the tolerance roughly halves the survivors; six rounds takes any
 *  realistic 12h trail under the cap. */
const SIMPLIFY_MAX_ROUNDS = 6;

/** A pause counts as "held this position" once it lasts this long… */
const DWELL_MIN_MS = 8 * 60_000;

/** …and stays a single dwell while every fix is within this of its anchor. */
const DWELL_RADIUS_M = 60;

/** Above this the medic is moving; below it they're milling about. */
const MOVING_SPEED_MPS = 0.7;

/** Trails are polled by the dashboard; a short cache absorbs that without
 *  re-reading the same rows. Well under the 5s write-flush cadence × 4, so a
 *  live trail still visibly grows. */
const CACHE_TTL_SECONDS = 20;

/** A finished event's archive is immutable — no reason to re-read it every
 *  20 seconds while a coordinator studies a debrief. */
const ARCHIVE_CACHE_TTL_SECONDS = 10 * 60;

/** Ceiling on a single multi-medic replay request. */
const MAX_BUNDLE_MEDICS = 30;

/** Event days and hours are written in local wall time; the store is UTC. */
const EVENT_TIMEZONE = "Europe/Sofia";

interface ResolvedWindow {
  mode: TrailWindowMode;
  from: Date;
  to: Date;
  /** Event mode only: the event's own dates. Null for a rolling window. */
  dates: string[] | null;
  /** Event mode only: the daily hours, when the event declares any. */
  dailyHours: { start: string; end: string } | null;
}

@Injectable()
export class TrailsService {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly events: EventsService,
  ) {}

  /**
   * Resolve what span a request actually covers.
   *
   * `event` mode is not bounded by TRAIL_MAX_HOURS — an archived race day is
   * legitimately longer than twelve hours, and history is only ever written
   * while an event is active, so the span can't sweep up unrelated movement.
   * It falls back to rolling for an event with no dates, rather than returning
   * an empty window that would look like "no data".
   */
  private resolveWindow(
    eventId: string,
    options: { mode?: TrailWindowMode; hours?: number },
  ): ResolvedWindow {
    if (options.mode === "event") {
      const span = this.events.getEventWindow(eventId);
      if (span) {
        return {
          mode: "event",
          from: new Date(span.from),
          to: new Date(span.to),
          dates: span.dates,
          dailyHours: span.hours,
        };
      }
    }
    const hours = clamp(options.hours ?? TRAIL_MAX_HOURS, 0.25, TRAIL_MAX_HOURS);
    const to = new Date();
    return {
      mode: "rolling",
      from: new Date(to.getTime() - hours * 3_600_000),
      to,
      dates: null,
      dailyHours: null,
    };
  }

  /**
   * The `recorded_at` predicate for a window.
   *
   * The from/to range comes first so the primary-key index still drives the
   * scan; the day and hour tests are filters layered on top. They are what make
   * "Event" mean the event's actual sessions rather than one contiguous block —
   * without them a two-day event includes the night between, and an event whose
   * dates include today includes all of today.
   */
  private windowPredicate(w: ResolvedWindow, firstParam: number): { sql: string; params: unknown[] } {
    const params: unknown[] = [w.from.toISOString(), w.to.toISOString()];
    let sql = `recorded_at >= $${firstParam} AND recorded_at <= $${firstParam + 1}`;
    let next = firstParam + 2;

    if (w.dates && w.dates.length > 0) {
      sql += ` AND (recorded_at AT TIME ZONE '${EVENT_TIMEZONE}')::date = ANY($${next}::date[])`;
      params.push(w.dates);
      next += 1;
    }
    if (w.dailyHours) {
      const { start, end } = w.dailyHours;
      const time = `(recorded_at AT TIME ZONE '${EVENT_TIMEZONE}')::time`;
      // An overnight window ("22:00"–"04:00") is two open-ended slices, not a range.
      sql +=
        start <= end
          ? ` AND ${time} BETWEEN $${next}::time AND $${next + 1}::time`
          : ` AND (${time} >= $${next}::time OR ${time} <= $${next + 1}::time)`;
      params.push(start, end);
    }
    return { sql, params };
  }

  /**
   * One medic's breadcrumbs over the last `hours`.
   *
   * Stats and dwells are computed from the RAW rows, then the geometry is
   * decimated for transport — so simplification can never change a reported
   * distance or shorten a recorded stop.
   */
  async getTrail(
    eventId: string,
    medicId: string,
    options: { hours?: number; maxPoints?: number; mode?: TrailWindowMode } = {},
  ): Promise<MedicTrail> {
    const resolved = this.resolveWindow(eventId, options);
    const { mode, from, to } = resolved;
    const maxPoints = clamp(Math.round(options.maxPoints ?? DEFAULT_MAX_POINTS), 50, MAX_POINTS_CEILING);

    // A finished event's archive never changes, so it is cached far longer
    // than a live rolling window that grows every few seconds.
    const isPast = mode === "event" && to.getTime() < Date.now();
    const ttl = isPast ? ARCHIVE_CACHE_TTL_SECONDS : CACHE_TTL_SECONDS;
    // Bucket the cache key to a 10s grid so a dashboard and a phone polling a
    // few hundred ms apart share one entry instead of thrashing it.
    const bucket = isPast ? "fixed" : Math.floor(Date.now() / (CACHE_TTL_SECONDS * 500));
    const cacheKey = `trail:${eventId}:${medicId}:${mode}:${from.getTime()}:${to.getTime()}:${resolved.dates?.join('') ?? ''}:${resolved.dailyHours?.start ?? ''}-${resolved.dailyHours?.end ?? ''}:${maxPoints}:${bucket}`;
    const cached = await this.redis.getJson<MedicTrail>(cacheKey).catch(() => null);
    if (cached) return cached;

    const where = this.windowPredicate(resolved, 3);
    const { rows } = await this.db.query<HistoryRow>(
      `SELECT recorded_at, lat, lng, speed, battery
         FROM medic_location_history
        WHERE event_id = $1 AND medic_id = $2 AND ${where.sql}
        ORDER BY recorded_at ASC`,
      [eventId, medicId, ...where.params],
    );

    const raw = toRawPoints(rows);
    const trail: MedicTrail = {
      eventId,
      medicId,
      name: await this.resolveName(eventId, medicId),
      vehicleType: await this.resolveVehicleType(eventId, medicId),
      mode,
      from: from.toISOString(),
      to: to.toISOString(),
      rawCount: raw.length,
      count: 0,
      samples: { t: [], lat: [], lng: [], spd: [], bat: [] },
      dwells: findDwells(raw),
      stats: computeStats(raw),
    };

    const simplified = simplifyToBudget(raw, maxPoints);
    trail.samples = toColumns(simplified);
    trail.count = simplified.length;

    await this.redis.setJson(cacheKey, trail, ttl).catch(() => undefined);
    return trail;
  }

  /** Several medics at once — the coordinator's team replay. */
  async getBundle(
    eventId: string,
    medicIds: string[],
    options: { hours?: number; maxPoints?: number; mode?: TrailWindowMode } = {},
  ): Promise<TrailBundle> {
    const { mode, from, to } = this.resolveWindow(eventId, options);
    const ids = dedupe(medicIds).slice(0, MAX_BUNDLE_MEDICS);

    // Each trail is individually cached, so a replay that adds one medic to the
    // selection only pays for that one.
    const trails = await Promise.all(ids.map((id) => this.getTrail(eventId, id, options)));

    return { eventId, mode, from: from.toISOString(), to: to.toISOString(), trails };
  }

  /**
   * Which medics actually have breadcrumbs in the window — so the dashboard can
   * offer a picker without requesting 40 empty trails. One grouped scan of the
   * hot partition, no per-medic round trips.
   */
  async listAvailable(
    eventId: string,
    options: { hours?: number; mode?: TrailWindowMode } = {},
  ): Promise<Array<{ medicId: string; name: string; points: number; firstAt: string; lastAt: string }>> {
    const resolved = this.resolveWindow(eventId, options);
    const where = this.windowPredicate(resolved, 2);

    const { rows } = await this.db.query<{
      medic_id: string;
      name: string | null;
      points: string;
      first_at: string | Date;
      last_at: string | Date;
    }>(
      `SELECT h.medic_id,
              COALESCE(l.name, em.name) AS name,
              COUNT(*)                  AS points,
              MIN(h.recorded_at)        AS first_at,
              MAX(h.recorded_at)        AS last_at
         FROM medic_location_history h
         LEFT JOIN medic_last_location l ON l.event_id = h.event_id AND l.medic_id = h.medic_id
         LEFT JOIN event_medics em       ON em.event_id = h.event_id AND em.id::text = h.medic_id
        WHERE h.event_id = $1 AND ${where.sql.replace(/recorded_at/g, "h.recorded_at")}
        GROUP BY h.medic_id, COALESCE(l.name, em.name)
        ORDER BY 2 NULLS LAST`,
      [eventId, ...where.params],
    );

    return rows.map((r) => ({
      medicId: r.medic_id,
      name: r.name ?? r.medic_id,
      points: Number(r.points),
      firstAt: new Date(r.first_at).toISOString(),
      lastAt: new Date(r.last_at).toISOString(),
    }));
  }

  /**
   * Is this caller allowed to read other people's trails?
   *
   * Two clients, two different truths, and they must agree. The dashboard
   * authenticates with a session whose role literally is "coordinator". The
   * mobile app does not — `joinAsMedic` stamps every rostered medic as role
   * "medic" regardless of seniority — so a coordinator on a phone has to be
   * recognised the way the rest of the app does it: by resolving their GLOBAL
   * role from `users`, matched through the roster by name.
   *
   * Without the second check the mobile UI (which reads seniority from the
   * roster) would offer a coordinator the button and the server would then
   * refuse the request.
   */
  async isCoordinator(eventId: string, userId: string, sessionRole?: string): Promise<boolean> {
    if (sessionRole === "coordinator") return true;
    const { rows } = await this.db.query<{ role: string | null }>(
      `SELECT u.role
         FROM event_medics em
         LEFT JOIN users u ON u.name = em.name
        WHERE em.event_id = $1 AND em.id::text = $2`,
      [eventId, userId],
    );
    return rows[0]?.role === "coordinator";
  }

  private async resolveName(eventId: string, medicId: string): Promise<string> {
    const { rows } = await this.db.query<{ name: string }>(
      `SELECT COALESCE(l.name, em.name) AS name
         FROM (SELECT $1::text AS event_id, $2::text AS medic_id) k
         LEFT JOIN medic_last_location l ON l.event_id = k.event_id AND l.medic_id = k.medic_id
         LEFT JOIN event_medics em       ON em.event_id = k.event_id AND em.id::text = k.medic_id`,
      [eventId, medicId],
    );
    return rows[0]?.name ?? medicId;
  }

  private async resolveVehicleType(eventId: string, medicId: string): Promise<VehicleType | undefined> {
    const { rows } = await this.db.query<{ vehicle_type: string | null }>(
      `SELECT vehicle_type FROM event_medics WHERE event_id = $1 AND id::text = $2`,
      [eventId, medicId],
    );
    return (rows[0]?.vehicle_type as VehicleType | undefined) ?? undefined;
  }
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function toRawPoints(rows: HistoryRow[]): RawPoint[] {
  return rows.map((r) => ({
    t: new Date(r.recorded_at).getTime(),
    lat: r.lat,
    lng: r.lng,
    spd: r.speed,
    bat: r.battery,
  }));
}

function toColumns(points: RawPoint[]): TrailSamples {
  return {
    // Coordinates are rounded to ~1cm. Anything finer is noise the GPS never
    // had, and it costs 6 characters per number over the wire.
    t: points.map((p) => p.t),
    lat: points.map((p) => round(p.lat, 7)),
    lng: points.map((p) => round(p.lng, 7)),
    spd: points.map((p) => (p.spd == null ? null : round(p.spd, 2))),
    bat: points.map((p) => (p.bat == null ? null : round(p.bat, 3))),
  };
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * Douglas–Peucker until the point count fits the budget, doubling the tolerance
 * each round. Chosen over uniform stride sampling because it keeps the corners
 * — the turns are the shape of a trail, and stride sampling rounds them off
 * while faithfully preserving long straight stretches nobody needs.
 */
function simplifyToBudget(points: RawPoint[], maxPoints: number): RawPoint[] {
  if (points.length <= maxPoints) return points;

  let epsilon = SIMPLIFY_BASE_EPSILON_M;
  let result = points;
  for (let pass = 0; pass < SIMPLIFY_MAX_ROUNDS; pass += 1) {
    result = douglasPeucker(points, epsilon);
    if (result.length <= maxPoints) return result;
    epsilon *= 2;
  }

  // Pathological trail (e.g. a device jittering wildly in place). Fall back to
  // an even stride so the response is still bounded.
  const stride = Math.ceil(result.length / maxPoints);
  const strided = result.filter((_, i) => i % stride === 0);
  const last = result[result.length - 1];
  if (strided[strided.length - 1] !== last) strided.push(last);
  return strided;
}

function douglasPeucker(points: RawPoint[], epsilonMeters: number): RawPoint[] {
  if (points.length < 3) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Iterative (explicit stack) — a 12h trail is long enough that recursion on a
  // degenerate, already-sorted path could get uncomfortably deep.
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;

    let farthest = -1;
    let maxDistance = 0;
    for (let i = start + 1; i < end; i += 1) {
      const distance = perpendicularDistanceM(points[i], points[start], points[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = i;
      }
    }

    if (maxDistance > epsilonMeters && farthest > 0) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}

/**
 * Distance from `p` to segment `a→b`, in metres. Latitude/longitude are
 * projected to a local metre plane first (longitude scaled by cos(lat)) so the
 * tolerance is a real distance rather than a degree value that means something
 * different at every latitude.
 */
function perpendicularDistanceM(p: RawPoint, a: RawPoint, b: RawPoint): number {
  const latScale = 111_320;
  const lngScale = 111_320 * Math.cos((a.lat * Math.PI) / 180);

  const px = (p.lng - a.lng) * lngScale;
  const py = (p.lat - a.lat) * latScale;
  const bx = (b.lng - a.lng) * lngScale;
  const by = (b.lat - a.lat) * latScale;

  const lengthSquared = bx * bx + by * by;
  if (lengthSquared === 0) return Math.hypot(px, py);

  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared));
  return Math.hypot(px - t * bx, py - t * by);
}

/**
 * Collapse stretches where the medic stayed put into single markers.
 *
 * Greedy from each unclaimed point: extend while every fix stays within
 * `DWELL_RADIUS_M` of the anchor, and emit if the span lasted long enough. The
 * marker sits at the centroid of the fixes, not the anchor, so it lands in the
 * middle of the aid station rather than on whichever edge they arrived from.
 */
function findDwells(points: RawPoint[]): TrailDwell[] {
  const dwells: TrailDwell[] = [];
  let i = 0;

  while (i < points.length) {
    const anchor = points[i];
    let j = i + 1;
    while (j < points.length && haversineMeters(anchor.lat, anchor.lng, points[j].lat, points[j].lng) <= DWELL_RADIUS_M) {
      j += 1;
    }

    const last = points[j - 1];
    const durationMs = last.t - anchor.t;
    if (j - i >= 2 && durationMs >= DWELL_MIN_MS) {
      const span = points.slice(i, j);
      dwells.push({
        lat: round(span.reduce((sum, p) => sum + p.lat, 0) / span.length, 6),
        lng: round(span.reduce((sum, p) => sum + p.lng, 0) / span.length, 6),
        from: new Date(anchor.t).toISOString(),
        to: new Date(last.t).toISOString(),
        durationMs,
      });
      i = j;
    } else {
      i += 1;
    }
  }

  return dwells;
}

function computeStats(points: RawPoint[]): TrailStats {
  // One fix says nothing about the rest of the window — reporting it as a
  // window-long stop would invent a stationary period nobody observed.
  if (points.length < 2) {
    return { distanceMeters: 0, movingMs: 0, stationaryMs: 0 };
  }

  let distanceMeters = 0;
  let movingMs = 0;
  let stationaryMs = 0;
  let maxSpeed = 0;
  let sawSpeed = false;

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const dt = current.t - previous.t;

    if (current.spd != null) {
      sawSpeed = true;
      maxSpeed = Math.max(maxSpeed, current.spd);
    }

    // A tracking outage is neither travel nor a stop — attributing it to either
    // would invent kilometres or invent a rest.
    if (dt <= 0 || dt > TRAIL_OUTAGE_GAP_MS) continue;

    const step = haversineMeters(previous.lat, previous.lng, current.lat, current.lng);
    if (step / (dt / 1000) >= MOVING_SPEED_MPS) {
      distanceMeters += step;
      movingMs += dt;
    } else {
      stationaryMs += dt;
    }
  }

  const batteryStart = points.find((p) => p.bat != null)?.bat ?? undefined;
  const batteryEnd = [...points].reverse().find((p) => p.bat != null)?.bat ?? undefined;

  return {
    distanceMeters: Math.round(distanceMeters),
    movingMs,
    stationaryMs,
    maxSpeed: sawSpeed ? round(maxSpeed, 2) : undefined,
    avgMovingSpeed: movingMs > 0 ? round(distanceMeters / (movingMs / 1000), 2) : undefined,
    batteryStart: batteryStart ?? undefined,
    batteryEnd: batteryEnd ?? undefined,
  };
}
