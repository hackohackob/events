export interface LngLat {
  lng: number;
  lat: number;
}

export function haversineMeters(a: LngLat, b: LngLat): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Cumulative distance (m) along a polyline of [lng,lat] points. */
export function cumulativeDistances(coords: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) {
    const prev = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
    const cur = { lng: coords[i][0], lat: coords[i][1] };
    out.push(out[i - 1] + haversineMeters(prev, cur));
  }
  return out;
}

/** Snap a position to the nearest vertex on the route; returns km-along + offset. */
export function snapToRoute(
  pos: LngLat,
  coords: [number, number][],
  cumulative: number[],
): { kmAlong: number; offsetMeters: number; index: number } {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversineMeters(pos, { lng: coords[i][0], lat: coords[i][1] });
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return {
    kmAlong: cumulative[bestIdx] / 1000,
    offsetMeters: bestDist,
    index: bestIdx,
  };
}

/** Interpolate the [lng,lat] position at a given km-along the route. */
export function pointAtKm(
  coords: [number, number][],
  cumulative: number[],
  km: number,
): [number, number] | null {
  if (coords.length === 0) return null;
  const target = km * 1000;
  if (target <= 0) return coords[0];
  for (let i = 1; i < coords.length; i++) {
    if (cumulative[i] >= target) {
      const span = cumulative[i] - cumulative[i - 1] || 1;
      const f = (target - cumulative[i - 1]) / span;
      const a = coords[i - 1];
      const b = coords[i];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
  }
  return coords[coords.length - 1];
}

export interface ElevStats {
  /** Elevation (m) at `fromKm`, interpolated from the GPX — the runner's height. */
  currentEle: number | null;
  totalAscent: number;
  totalDescent: number;
  /** Ascent / descent still ahead, from `fromKm` to the end. */
  remainingAscent: number;
  remainingDescent: number;
  maxEle: number | null;
}

/**
 * Elevation stats from a track's per-point elevations. Computed from the raw GPX
 * heights (not trusting possibly-broken precomputed meta), and split into total
 * vs. remaining (ahead of the runner's position). `fromKm` null → treats the
 * runner as at the start.
 */
export function elevationStats(
  elevations: (number | undefined)[],
  cumulative: number[],
  fromKm: number | null,
): ElevStats {
  const pts: Array<{ d: number; e: number }> = [];
  for (let i = 0; i < elevations.length; i += 1) {
    const e = elevations[i];
    if (e != null && Number.isFinite(e)) pts.push({ d: cumulative[i], e });
  }
  if (pts.length === 0) {
    return { currentEle: null, totalAscent: 0, totalDescent: 0, remainingAscent: 0, remainingDescent: 0, maxEle: null };
  }

  let totalAscent = 0;
  let totalDescent = 0;
  let maxEle = pts[0].e;
  for (let i = 1; i < pts.length; i += 1) {
    const dz = pts[i].e - pts[i - 1].e;
    if (dz > 0) totalAscent += dz;
    else totalDescent += -dz;
    if (pts[i].e > maxEle) maxEle = pts[i].e;
  }

  const fromDist = fromKm != null ? Math.max(0, fromKm * 1000) : 0;
  const currentEle = interpEle(pts, fromDist);
  let remainingAscent = 0;
  let remainingDescent = 0;
  let prevE = currentEle;
  for (const p of pts) {
    if (p.d <= fromDist) continue;
    const dz = p.e - prevE;
    if (dz > 0) remainingAscent += dz;
    else remainingDescent += -dz;
    prevE = p.e;
  }
  return { currentEle, totalAscent, totalDescent, remainingAscent, remainingDescent, maxEle };
}

function interpEle(pts: Array<{ d: number; e: number }>, dist: number): number {
  if (dist <= pts[0].d) return pts[0].e;
  for (let i = 1; i < pts.length; i += 1) {
    if (pts[i].d >= dist) {
      const span = pts[i].d - pts[i - 1].d || 1;
      const f = (dist - pts[i - 1].d) / span;
      return pts[i - 1].e + (pts[i].e - pts[i - 1].e) * f;
    }
  }
  return pts[pts.length - 1].e;
}

/** Compass bearing in degrees (0 = north) from point a to point b. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}
