/** Small geometry helpers for team drawings. Everything is `[lng, lat]`. */

export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_000;
const RAD = Math.PI / 180;

function metersBetween(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function lineLengthMeters(line: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) total += metersBetween(line[i - 1]!, line[i]!);
  return total;
}

/** The longest stroke of a drawing — the one its label belongs to. */
export function longestLine(lines: LngLat[][]): LngLat[] {
  let best: LngLat[] = lines[0] ?? [];
  let bestLength = -1;
  for (const line of lines) {
    const length = lineLengthMeters(line);
    if (length > bestLength) {
      best = line;
      bestLength = length;
    }
  }
  return best;
}

/** The point halfway along a line — where its label sits. */
export function midpointAlong(line: LngLat[]): LngLat {
  if (line.length === 0) return [0, 0];
  if (line.length === 1) return line[0]!;
  const half = lineLengthMeters(line) / 2;
  let travelled = 0;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const seg = metersBetween(a, b);
    if (seg > 0 && travelled + seg >= half) {
      const t = (half - travelled) / seg;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    travelled += seg;
  }
  return line[line.length - 1]!;
}

/** `[minLng, minLat, maxLng, maxLat]`, or null for an empty drawing. */
export function boundsOf(lines: LngLat[][]): [number, number, number, number] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const line of lines) {
    for (const [lng, lat] of line) {
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/** "840 m", "1.24 km", "12.6 km". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "0 m";
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(2)} km`;
  return `${(meters / 1000).toFixed(1)} km`;
}
