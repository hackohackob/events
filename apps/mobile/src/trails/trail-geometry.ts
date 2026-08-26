import { TRAIL_OUTAGE_GAP_MS, type MedicTrail } from "@events/contracts";

export type LngLat = [number, number];

/** Columnar samples → the `[lng, lat]` path maplibre wants. */
export function trailPath(trail: MedicTrail): LngLat[] {
  const { lat, lng } = trail.samples;
  const path: LngLat[] = [];
  for (let i = 0; i < lng.length; i += 1) path.push([lng[i], lat[i]]);
  return path;
}

/** Last sample at or before `atMs` (-1 before the trail starts). Binary search
 *  — the scrubber calls this on every drag frame. */
export function sampleIndexAt(trail: MedicTrail, atMs: number): number {
  const t = trail.samples.t;
  let low = 0;
  let high = t.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (t[mid] <= atMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** Interpolated position at `atMs`, so scrubbing glides instead of hopping
 *  between breadcrumbs. Null before the first sample. */
export function positionAt(trail: MedicTrail, atMs: number): LngLat | null {
  const { t, lat, lng } = trail.samples;
  if (t.length === 0) return null;
  const i = sampleIndexAt(trail, atMs);
  if (i < 0) return null;
  if (i >= t.length - 1) return [lng[t.length - 1], lat[t.length - 1]];

  const span = t[i + 1] - t[i];
  const f = span > 0 ? (atMs - t[i]) / span : 0;
  return [lng[i] + (lng[i + 1] - lng[i]) * f, lat[i] + (lat[i + 1] - lat[i]) * f];
}

/** The path up to `atMs`, ending exactly under the scrub puck. */
export function pathUntil(trail: MedicTrail, atMs: number): LngLat[] {
  const i = sampleIndexAt(trail, atMs);
  if (i < 0) return [];
  const { lat, lng } = trail.samples;
  const path: LngLat[] = [];
  for (let k = 0; k <= i; k += 1) path.push([lng[k], lat[k]]);
  const head = positionAt(trail, atMs);
  const tail = path[path.length - 1];
  if (head && (!tail || head[0] !== tail[0] || head[1] !== tail[1])) path.push(head);
  return path;
}


/**
 * One continuous stretch of reporting, with its position in the whole trail's
 * drawn length. Trails break into runs at tracking outages so the line stops
 * where the medic went dark instead of drawing a straight line across the map
 * — which reads as travel that never happened.
 *
 * `startFrac`/`endFrac` are the run's share of the total drawn length, so each
 * run carries the slice of the overall age gradient that belongs to it and the
 * comet still fades continuously across the breaks.
 */
export interface TrailRun {
  coordinates: LngLat[];
  startFrac: number;
  endFrac: number;
}

/** Beyond this many runs, drawing the trail whole costs less than the per-run
 *  native sources. A 12h trail with 50 outages is a broken device, not a shift. */
const MAX_RUNS = 50;

/** Split a trail into continuous runs, optionally clipped to a scrub cursor. */
export function trailRuns(trail: MedicTrail, untilMs?: number): TrailRun[] {
  const { t, lat, lng } = trail.samples;
  const last = untilMs == null ? t.length - 1 : sampleIndexAt(trail, untilMs);
  if (last < 0) return [];

  const groups: LngLat[][] = [];
  let current: LngLat[] = [];
  for (let i = 0; i <= last; i += 1) {
    if (i > 0 && t[i] - t[i - 1] > TRAIL_OUTAGE_GAP_MS) {
      groups.push(current);
      current = [];
    }
    current.push([lng[i], lat[i]]);
  }
  // The interpolated head keeps the line ending under the scrub puck.
  if (untilMs != null) {
    const head = positionAt(trail, untilMs);
    const tail = current[current.length - 1];
    if (head && (!tail || head[0] !== tail[0] || head[1] !== tail[1])) current.push(head);
  }
  groups.push(current);

  const drawable = groups.filter((g) => g.length >= 2);
  if (drawable.length === 0) return [];
  if (drawable.length > MAX_RUNS) {
    return [{ coordinates: drawable.flat(), startFrac: 0, endFrac: 1 }];
  }

  // Parameterise by drawn length, matching how maplibre computes line-progress.
  const lengths = drawable.map(pathLength);
  const total = lengths.reduce((a, b) => a + b, 0);
  let cumulative = 0;
  return drawable.map((coordinates, i) => {
    const startFrac = total > 0 ? cumulative / total : 0;
    cumulative += lengths[i];
    return { coordinates, startFrac, endFrac: total > 0 ? cumulative / total : 1 };
  });
}

/** Planar length in degrees — only used for *relative* weighting between runs
 *  of one trail, so it needs no earth-radius correction. */
function pathLength(path: LngLat[]): number {
  let sum = 0;
  for (let i = 1; i < path.length; i += 1) {
    sum += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  return sum;
}

/** The age-gradient ramp: near-invisible at the oldest end, full colour at the
 *  newest. A function so a run covering part of the trail gets its own slice. */
export function trailRampColor(hex: string, at: number): string {
  const t = Math.min(1, Math.max(0, at));
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  const stops: Array<[number, [number, number, number, number]]> = [
    [0, [148, 163, 184, 0.1]],
    [0.35, [r, g, b, 0.35]],
    [0.75, [r, g, b, 0.8]],
    [1, [r, g, b, 1]],
  ];
  for (let i = 1; i < stops.length; i += 1) {
    const [p0, c0] = stops[i - 1];
    const [p1, c1] = stops[i];
    if (t > p1) continue;
    const f = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
    const mix = (a: number, b2: number) => a + (b2 - a) * f;
    return `rgba(${Math.round(mix(c0[0], c1[0]))},${Math.round(mix(c0[1], c1[1]))},${Math.round(mix(c0[2], c1[2]))},${mix(c0[3], c1[3]).toFixed(3)})`;
  }
  return hex;
}

/** Bounding box of a trail as `[[west, south], [east, north]]`. */
export function trailBounds(trail: MedicTrail): [LngLat, LngLat] | null {
  const { lat, lng } = trail.samples;
  if (lng.length === 0) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (let i = 0; i < lng.length; i += 1) {
    if (lng[i] < minLng) minLng = lng[i];
    if (lng[i] > maxLng) maxLng = lng[i];
    if (lat[i] < minLat) minLat = lat[i];
    if (lat[i] > maxLat) maxLat = lat[i];
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/**
 * Duration for a map badge, where every character costs width: "9m", "2h33m",
 * "4h". Drops the space that made "2h 33m" wrap inside its own marker.
 */
export function formatDurationCompact(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h${minutes}m`;
}

export function formatSpeed(mps?: number): string {
  return mps == null ? "—" : `${(mps * 3.6).toFixed(1)} km/h`;
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
