/**
 * Zone geometry helpers: freehand sketch post-processing (thin out the dense
 * touch trail, then Chaikin-smooth the corners) and point-in-polygon for the
 * medic entry alarm. All coordinates are [lng, lat].
 */

export type Ring = [number, number][];

function dist2(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/** Drop points closer together than a tolerance derived from the sketch size. */
function simplify(points: Ring): Ring {
  if (points.length < 3) return points;
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const diag = Math.hypot(maxLng - minLng, maxLat - minLat);
  const tol2 = (diag * 0.008) ** 2; // ~0.8% of the sketch diagonal
  const out: Ring = [points[0]];
  for (const p of points) {
    if (dist2(out[out.length - 1], p) >= tol2) out.push(p);
  }
  return out;
}

/** One round of Chaikin corner-cutting on a CLOSED ring. */
function chaikinClosed(points: Ring): Ring {
  const out: Ring = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
    out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  return out;
}

/** Simplify + smooth a freehand ring; [] when the sketch is too small. */
export function smoothZonePolygon(raw: Ring, iterations = 2): Ring {
  let ring = simplify(raw);
  if (ring.length < 3) return [];
  for (let i = 0; i < iterations; i += 1) ring = chaikinClosed(ring);
  return ring;
}

/** Ray-casting containment test (ring is implicitly closed). */
export function pointInPolygon(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Ring centroid (vertex average — good enough for a label anchor). */
export function ringCentroid(ring: Ring): [number, number] {
  let lng = 0;
  let lat = 0;
  for (const p of ring) {
    lng += p[0];
    lat += p[1];
  }
  return [lng / ring.length, lat / ring.length];
}
