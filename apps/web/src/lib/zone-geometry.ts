/**
 * Freehand-drawn zone post-processing: thin out the dense pointer trail, then
 * round the corners so the region reads as a deliberate area, not a shaky
 * scribble. All coordinates are [lng, lat].
 */

type Pt = [number, number];

function dist2(a: Pt, b: Pt): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/** Drop points closer together than a tolerance derived from the sketch size. */
function simplify(points: Pt[]): Pt[] {
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
  const out: Pt[] = [points[0]];
  for (const p of points) {
    if (dist2(out[out.length - 1], p) >= tol2) out.push(p);
  }
  return out;
}

/** One round of Chaikin corner-cutting on a CLOSED ring. */
function chaikinClosed(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
    out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  return out;
}

/**
 * Simplify + smooth a freehand polygon ring. Returns at least a triangle, or
 * an empty array when the sketch is too small to make a region out of.
 */
export function smoothZonePolygon(raw: Pt[], iterations = 2): Pt[] {
  let ring = simplify(raw);
  if (ring.length < 3) return [];
  for (let i = 0; i < iterations; i += 1) ring = chaikinClosed(ring);
  return ring;
}

/** GeoJSON Polygon feature for a zone ring (closes the ring). */
export function zoneFeature(polygon: Pt[], properties: Record<string, unknown> = {}) {
  return {
    type: "Feature" as const,
    properties,
    geometry: { type: "Polygon" as const, coordinates: [[...polygon, polygon[0]]] },
  };
}
