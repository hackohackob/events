import type { LngLat } from "./routing.types";

/**
 * "Avoid incoming traffic" routing.
 *
 * Stock GraphHopper (flexible mode) can't weight edges by direction-of-travel
 * against an arbitrary reference line, so true directional avoidance isn't
 * expressible in a per-request custom model. The practical, robust approximation
 * is to discourage the whole race corridor: we buffer each race track into a
 * thin polygon ribbon and apply a strong (but soft) priority penalty inside it.
 *
 * The router then prefers parallel service roads and only drops onto the course
 * when there's no real alternative (e.g. to reach an on-course incident) — which
 * keeps medics off the live racing line, i.e. out of the runners' oncoming flow,
 * wherever the road network allows.
 *
 * The output is a GraphHopper custom-model fragment ({ priority, areas }) that is
 * merged into the route request. Areas are per-segment quads (a GraphHopper area
 * is a single Polygon), referenced as `in_<id>` from one priority rule each.
 */

export interface CorridorModel {
  priority: Array<{ if: string; multiply_by: number }>;
  areas: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      id: string;
      properties: Record<string, never>;
      geometry: { type: "Polygon"; coordinates: number[][][] };
    }>;
  };
}

export interface CorridorOptions {
  /** Half-width of the avoided ribbon, metres each side of the line. */
  bufferMeters?: number;
  /** Priority multiplier inside the corridor (0–1; lower = stronger avoidance). */
  multiplyBy?: number;
  /** Hard cap on the number of area polygons across all tracks. */
  maxAreas?: number;
}

const METERS_PER_DEG_LAT = 111_320;

/** Even-stride downsample so a long track doesn't blow past the area budget. */
function downsample(points: LngLat[], maxPoints: number): LngLat[] {
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const out: LngLat[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]!);
  const last = points[points.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** One buffered quad polygon (closed ring) for the segment a→b. */
function segmentQuad(a: LngLat, b: LngLat, bufferMeters: number): number[][] | null {
  const latRad = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const mPerDegLng = METERS_PER_DEG_LAT * Math.cos(latRad);
  // Segment vector in metres.
  const dx = (b[0] - a[0]) * mPerDegLng;
  const dy = (b[1] - a[1]) * METERS_PER_DEG_LAT;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return null;
  // Perpendicular unit vector (metres) → offset in degrees.
  const px = (-dy / len) * bufferMeters;
  const py = (dx / len) * bufferMeters;
  const offLng = px / mPerDegLng;
  const offLat = py / METERS_PER_DEG_LAT;
  const aL: number[] = [a[0] + offLng, a[1] + offLat];
  const bL: number[] = [b[0] + offLng, b[1] + offLat];
  const bR: number[] = [b[0] - offLng, b[1] - offLat];
  const aR: number[] = [a[0] - offLng, a[1] - offLat];
  return [aL, bL, bR, aR, aL];
}

/**
 * Build the corridor custom-model fragment from one or more race tracks, or null
 * when there's nothing usable to avoid.
 */
export function buildCorridorModel(tracks: LngLat[][], options: CorridorOptions = {}): CorridorModel | null {
  // Wider buffer: a GPX line is often offset from the OSM road centreline by a
  // good few metres, and the corridor polygon must actually contain the edge
  // GraphHopper routes on or the penalty is a no-op. Stronger multiplier so the
  // router meaningfully prefers parallel roads. Tunable via env without a deploy.
  const bufferMeters = options.bufferMeters ?? Number(process.env.AVOID_CORRIDOR_BUFFER_M ?? 40);
  const multiplyBy = options.multiplyBy ?? Number(process.env.AVOID_CORRIDOR_MULTIPLY ?? 0.03);
  const maxAreas = options.maxAreas ?? 120;

  const usable = tracks.filter((t) => t.length >= 2);
  if (usable.length === 0) return null;

  // Split the area budget across tracks.
  const perTrack = Math.max(2, Math.floor(maxAreas / usable.length) + 1);

  const features: CorridorModel["areas"]["features"] = [];
  const priority: CorridorModel["priority"] = [];

  for (const track of usable) {
    const pts = downsample(track, perTrack + 1);
    for (let i = 0; i < pts.length - 1 && features.length < maxAreas; i++) {
      const ring = segmentQuad(pts[i]!, pts[i + 1]!, bufferMeters);
      if (!ring) continue;
      const id = `race_${features.length}`;
      features.push({ type: "Feature", id, properties: {}, geometry: { type: "Polygon", coordinates: [ring] } });
      priority.push({ if: `in_${id}`, multiply_by: multiplyBy });
    }
  }

  if (features.length === 0) return null;
  return { priority, areas: { type: "FeatureCollection", features } };
}

/**
 * Merge a corridor fragment into an existing custom model (e.g. the rescue_4x4
 * inline model). GraphHopper concatenates priority/speed rules and merges areas,
 * but when we build the body ourselves we merge explicitly so a single
 * `custom_model` carries both.
 */
export function mergeCustomModel(
  base: Record<string, unknown> | undefined,
  corridor: CorridorModel,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  const basePriority = Array.isArray(out.priority) ? (out.priority as unknown[]) : [];
  out.priority = [...basePriority, ...corridor.priority];
  const baseAreas = (out.areas as CorridorModel["areas"] | undefined)?.features ?? [];
  out.areas = { type: "FeatureCollection", features: [...baseAreas, ...corridor.areas.features] };
  return out;
}
