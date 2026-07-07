/**
 * Pure geometry preprocessing for track-following navigation.
 *
 * GPX tracks don't exist in the routing graph, so turn instructions are
 * derived from the polyline itself: simplify away GPS jitter, measure the
 * bearing change at each remaining vertex over ~25 m arcs, classify the
 * deltas into maneuvers, and pin each one to its arc-length position.
 *
 * Everything here is side-effect free and runs once when tracking starts.
 */
import { bearingDegrees, distanceMeters, toLatLng } from "../navigation/geo";
import type { LngLat, ManeuverKind } from "../navigation/types";

export interface TrackInstruction {
  /** Arc-length position of the maneuver on the ORIGINAL geometry, metres. */
  alongMeters: number;
  maneuver: ManeuverKind;
  text: string;
  location: LngLat;
}

export interface PreparedTrack {
  geometry: LngLat[];
  /** Cumulative metres at each vertex of `geometry`. */
  cum: number[];
  totalMeters: number;
  instructions: TrackInstruction[];
}

// Jitter removal: GPX points closer than this to the simplified line are noise.
const SIMPLIFY_EPSILON_M = 6;
// Bearings are measured over this much arc on each side of a vertex, so the
// classification is stable regardless of GPX point density (1–50 m spacing).
const BEARING_WINDOW_M = 25;
// |bearing change| classification bounds (degrees).
const IGNORE_BELOW_DEG = 28;
const SLIGHT_MAX_DEG = 45;
const TURN_MAX_DEG = 105;
const SHARP_MAX_DEG = 150;
// Maneuvers closer than this in arc-length merge into the stronger one.
const MERGE_WITHIN_M = 30;

/** Signed smallest angle from `from` to `to`, degrees in (-180, 180]. Positive = clockwise (right). */
export function signedAngleDiff(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Cumulative metres at each vertex. */
export function cumulativeMeters(geometry: LngLat[]): number[] {
  const cum = [0];
  for (let i = 1; i < geometry.length; i += 1) {
    cum.push(cum[i - 1] + distanceMeters(toLatLng(geometry[i - 1]), toLatLng(geometry[i])));
  }
  return cum;
}

/**
 * Douglas-Peucker simplification returning the KEPT ORIGINAL INDICES (sorted).
 * Working in indices means each detected turn keeps its exact arc-length
 * position on the original geometry — no re-projection needed (which would be
 * unsafe on self-intersecting tracks).
 */
export function simplifyIndices(geometry: LngLat[], epsilonMeters = SIMPLIFY_EPSILON_M): number[] {
  if (geometry.length <= 2) return geometry.map((_, i) => i);

  // Equirectangular projection to metres (fine at track scale).
  const lat0 = (geometry[0][1] * Math.PI) / 180;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(lat0);
  const pts = geometry.map(([lng, lat]): [number, number] => [lng * mPerDegLng, lat * mPerDegLat]);

  const keep = new Uint8Array(geometry.length);
  keep[0] = 1;
  keep[geometry.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, geometry.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;
    const [ax, ay] = pts[start];
    const [bx, by] = pts[end];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;

    let maxDist = -1;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i += 1) {
      const [px, py] = pts[i];
      let dist: number;
      if (len2 === 0) {
        dist = Math.hypot(px - ax, py - ay);
      } else {
        // Distance to the infinite line — standard DP uses the segment's line.
        dist = Math.abs(dy * px - dx * py + bx * ay - by * ax) / Math.sqrt(len2);
      }
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    if (maxDist > epsilonMeters && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < keep.length; i += 1) if (keep[i]) out.push(i);
  return out;
}

/** Point at `targetAlong` on the simplified path (walking kept vertices), for bearing windows. */
function pointAtAlong(
  geometry: LngLat[],
  cum: number[],
  keptIdx: number[],
  keptPos: number,
  direction: -1 | 1,
  windowM: number,
): LngLat {
  const startAlong = cum[keptIdx[keptPos]];
  let pos = keptPos;
  while (pos + direction >= 0 && pos + direction < keptIdx.length) {
    const nextPos = pos + direction;
    const travelled = Math.abs(cum[keptIdx[nextPos]] - startAlong);
    pos = nextPos;
    if (travelled >= windowM) break;
  }
  return geometry[keptIdx[pos]];
}

function classify(deltaDeg: number): ManeuverKind | null {
  const mag = Math.abs(deltaDeg);
  if (mag < IGNORE_BELOW_DEG) return null;
  if (mag > SHARP_MAX_DEG) return "uturn";
  const dir = deltaDeg > 0 ? "right" : "left";
  if (mag <= SLIGHT_MAX_DEG) return `turn-slight-${dir}` as ManeuverKind;
  if (mag <= TURN_MAX_DEG) return `turn-${dir}` as ManeuverKind;
  return `turn-sharp-${dir}` as ManeuverKind;
}

function maneuverText(kind: ManeuverKind): string {
  switch (kind) {
    case "turn-left": return "Turn left";
    case "turn-right": return "Turn right";
    case "turn-slight-left": return "Slight left";
    case "turn-slight-right": return "Slight right";
    case "turn-sharp-left": return "Sharp left";
    case "turn-sharp-right": return "Sharp right";
    case "uturn": return "Make a U-turn";
    case "arrive": return "You have arrived at the end of the track";
    default: return "Continue";
  }
}

/**
 * Full preprocessing: simplification → per-vertex bearing deltas → classified,
 * merged instructions + an "arrive" terminator.
 */
export function prepareTrack(geometry: LngLat[]): PreparedTrack {
  const cum = cumulativeMeters(geometry);
  const totalMeters = cum[cum.length - 1] ?? 0;
  const instructions: Array<TrackInstruction & { deltaDeg: number }> = [];

  if (geometry.length >= 3 && totalMeters > 0) {
    const keptIdx = simplifyIndices(geometry);
    for (let pos = 1; pos < keptIdx.length - 1; pos += 1) {
      const vertex = geometry[keptIdx[pos]];
      const before = pointAtAlong(geometry, cum, keptIdx, pos, -1, BEARING_WINDOW_M);
      const after = pointAtAlong(geometry, cum, keptIdx, pos, 1, BEARING_WINDOW_M);
      const bIn = bearingDegrees(toLatLng(before), toLatLng(vertex));
      const bOut = bearingDegrees(toLatLng(vertex), toLatLng(after));
      const delta = signedAngleDiff(bIn, bOut);
      const kind = classify(delta);
      if (!kind) continue;
      instructions.push({
        alongMeters: cum[keptIdx[pos]],
        maneuver: kind,
        text: maneuverText(kind),
        location: vertex,
        deltaDeg: delta,
      });
    }
  }

  // Merge maneuvers that crowd together (switchback jitter) — keep the stronger.
  const merged: Array<TrackInstruction & { deltaDeg: number }> = [];
  for (const inst of instructions) {
    const prev = merged[merged.length - 1];
    if (prev && inst.alongMeters - prev.alongMeters < MERGE_WITHIN_M) {
      if (Math.abs(inst.deltaDeg) > Math.abs(prev.deltaDeg)) merged[merged.length - 1] = inst;
    } else {
      merged.push(inst);
    }
  }

  const final: TrackInstruction[] = merged.map(({ deltaDeg: _d, ...rest }) => rest);
  final.push({
    alongMeters: totalMeters,
    maneuver: "arrive",
    text: maneuverText("arrive"),
    location: geometry[geometry.length - 1] ?? [0, 0],
  });

  return { geometry, cum, totalMeters, instructions: final };
}

/** Vertex index whose cumulative distance is the last one <= `along` (binary search). */
export function vertexIndexAtAlong(cum: number[], along: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= along) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Split the track at an arc-length position — used to dim the travelled part. */
export function splitAtAlong(
  track: PreparedTrack,
  along: number,
  snapped: { lat: number; lng: number },
): { behind: LngLat[]; ahead: LngLat[] } {
  const idx = vertexIndexAtAlong(track.cum, along);
  const snapLngLat: LngLat = [snapped.lng, snapped.lat];
  const behind = [...track.geometry.slice(0, idx + 1), snapLngLat];
  const ahead = [snapLngLat, ...track.geometry.slice(idx + 1)];
  return { behind, ahead };
}
