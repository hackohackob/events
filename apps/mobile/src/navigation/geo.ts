import type { LatLng, LngLat } from "./types";

const EARTH_RADIUS_M = 6371000;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from north (0–360). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export const toLatLng = ([lng, lat]: LngLat): LatLng => ({ lat, lng });
export const toLngLat = ({ lat, lng }: LatLng): LngLat => [lng, lat];

/** Total length of a `[lng, lat]` polyline in metres. */
export function geometryLengthMeters(geometry: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < geometry.length; i += 1) {
    total += distanceMeters(toLatLng(geometry[i - 1]), toLatLng(geometry[i]));
  }
  return total;
}

export interface SnapResult {
  /** Nearest point on the polyline. */
  point: LatLng;
  /** Index of the polyline vertex at the start of the matched segment. */
  segmentIndex: number;
  /** Perpendicular distance from the query point to the polyline, metres. */
  distanceMeters: number;
  /** Distance travelled along the polyline up to the snapped point, metres. */
  alongMeters: number;
}

/**
 * Snap a position onto a `[lng, lat]` polyline, returning the closest point, the
 * segment it fell on, and how far along the line that is. Drives off-route
 * detection + "distance to next maneuver" during active navigation.
 *
 * Uses an equirectangular local projection (fine at navigation scale).
 */
export function snapToPolyline(position: LatLng, geometry: LngLat[]): SnapResult | null {
  if (geometry.length < 2) return null;
  const lat0 = toRad(position.lat);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(lat0);
  const project = (lng: number, lat: number): [number, number] => [lng * mPerDegLng, lat * mPerDegLat];
  const [px, py] = project(position.lng, position.lat);

  let best: SnapResult | null = null;
  let cumulative = 0;

  for (let i = 1; i < geometry.length; i += 1) {
    const [alng, alat] = geometry[i - 1];
    const [blng, blat] = geometry[i];
    const [ax, ay] = project(alng, alat);
    const [bx, by] = project(blng, blat);
    const dx = bx - ax;
    const dy = by - ay;
    const segLen2 = dx * dx + dy * dy;
    const t = segLen2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / segLen2));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const dist = Math.hypot(px - cx, py - cy);
    if (!best || dist < best.distanceMeters) {
      const segLen = Math.sqrt(segLen2);
      best = {
        point: { lat: alat + (blat - alat) * t, lng: alng + (blng - alng) * t },
        segmentIndex: i - 1,
        distanceMeters: dist,
        alongMeters: cumulative + segLen * t,
      };
    }
    cumulative += Math.hypot(dx, dy);
  }
  return best;
}

export interface ClippedRoute {
  geometry: LngLat[];
  segments: Array<{ surface: "road" | "offroad" | "path"; coordinates: LngLat[] }>;
  remainingMeters: number;
  /** Fraction of the route still ahead (0–1). */
  fraction: number;
  /** Snapped position on the route (where the medic currently is). */
  snapped: LatLng;
}

/**
 * Clip a route to the part still *ahead* of a position — used to hide the
 * already-covered portion of a navigating medic's path, and to recompute the
 * live remaining distance/ETA from the medic's current location.
 */
export function clipRouteAhead(
  geometry: LngLat[],
  segments: Array<{ surface: "road" | "offroad" | "path"; coordinates: LngLat[] }>,
  position: LatLng,
): ClippedRoute {
  const total = geometryLengthMeters(geometry);
  const snap = snapToPolyline(position, geometry);
  if (!snap || geometry.length < 2) {
    return { geometry, segments, remainingMeters: total, fraction: 1, snapped: position };
  }
  const remainingMeters = Math.max(0, total - snap.alongMeters);
  const fraction = total > 0 ? remainingMeters / total : 0;
  const snapLngLat: LngLat = [snap.point.lng, snap.point.lat];
  const aheadGeometry: LngLat[] = [snapLngLat, ...geometry.slice(snap.segmentIndex + 1)];

  // Clip each coloured segment to the part beyond the snapped along-distance.
  let acc = 0;
  let prependedSnap = false;
  const clippedSegments: ClippedRoute["segments"] = [];
  for (const seg of segments) {
    const kept: LngLat[] = [];
    for (let i = 0; i < seg.coordinates.length; i += 1) {
      if (i > 0) acc += distanceMeters(toLatLng(seg.coordinates[i - 1]), toLatLng(seg.coordinates[i]));
      if (acc >= snap.alongMeters) {
        if (kept.length === 0 && !prependedSnap) {
          kept.push(snapLngLat);
          prependedSnap = true;
        }
        kept.push(seg.coordinates[i]);
      }
    }
    if (kept.length >= 2) clippedSegments.push({ surface: seg.surface, coordinates: kept });
  }

  return {
    geometry: aheadGeometry.length >= 2 ? aheadGeometry : geometry,
    segments: clippedSegments.length > 0 ? clippedSegments : segments,
    remainingMeters,
    fraction,
    snapped: snap.point,
  };
}

/**
 * A gently curved arc between two points (quadratic bezier with a perpendicular
 * bulge), like the great-circle lines drawn between airports. Used for the
 * "assigned to incident" line before the medic actually starts navigating.
 */
export function arcPoints(a: LatLng, b: LatLng, segments = 28, curvature = 0.18): LngLat[] {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len = Math.hypot(dx, dy) || 1e-9;
  // Control point: midpoint pushed perpendicular to the A→B line.
  const cx = (a.lng + b.lng) / 2 + (-dy / len) * len * curvature;
  const cy = (a.lat + b.lat) / 2 + (dx / len) * len * curvature;
  const pts: LngLat[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const x = (1 - t) ** 2 * a.lng + 2 * (1 - t) * t * cx + t ** 2 * b.lng;
    const y = (1 - t) ** 2 * a.lat + 2 * (1 - t) * t * cy + t ** 2 * b.lat;
    pts.push([x, y]);
  }
  return pts;
}

/** "120 m" / "2.4 km" — distance readout for the nav UI. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

/** "52 min" / "1 h 04" — duration readout. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

/** Clock ETA "16:57" given a remaining duration from now. */
export function formatEta(remainingMs: number): string {
  if (!Number.isFinite(remainingMs)) return "—";
  const eta = new Date(Date.now() + remainingMs);
  return `${String(eta.getHours()).padStart(2, "0")}:${String(eta.getMinutes()).padStart(2, "0")}`;
}
