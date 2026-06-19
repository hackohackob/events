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
