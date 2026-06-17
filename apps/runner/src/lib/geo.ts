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

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}
