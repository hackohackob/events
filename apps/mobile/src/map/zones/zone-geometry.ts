/**
 * Zone geometry helpers: freehand sketch post-processing (thin out the dense
 * touch trail, then Chaikin-smooth the corners) and point-in-polygon for the
 * medic entry alarm. All coordinates are [lng, lat].
 */

export type Pt = [number, number];
export type Ring = Pt[];

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

/** Shoelace area of a closed ring (sign = winding direction). */
function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum / 2;
}

/**
 * Proper crossing point of two segments, or null. Touching at an endpoint
 * (ua/ub exactly 0 or 1) is NOT a crossing — consecutive ring segments always
 * share a vertex.
 */
function segmentCrossing(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const d = (p4[1] - p3[1]) * (p2[0] - p1[0]) - (p4[0] - p3[0]) * (p2[1] - p1[1]);
  if (Math.abs(d) < 1e-14) return null; // parallel or degenerate
  const ua = ((p4[0] - p3[0]) * (p1[1] - p3[1]) - (p4[1] - p3[1]) * (p1[0] - p3[0])) / d;
  const ub = ((p2[0] - p1[0]) * (p1[1] - p3[1]) - (p2[1] - p1[1]) * (p1[0] - p3[0])) / d;
  if (ua <= 0 || ua >= 1 || ub <= 0 || ub >= 1) return null;
  return [p1[0] + ua * (p2[0] - p1[0]), p1[1] + ua * (p2[1] - p1[1])];
}

/**
 * Turn a self-crossing freehand ring into a simple one.
 *
 * A finger rarely closes a loop cleanly — it overshoots, or doubles back, and
 * the stroke crosses itself. Filling such a ring (and testing containment
 * against it) uses the even-odd rule, so the overlapped part reads as a HOLE:
 * the zone looks like it has a bite taken out of it and medics standing there
 * don't trigger the alarm.
 *
 * Each crossing splits the ring into two loops. We keep the larger one and
 * repeat, so what survives is the outer boundary the user actually drew and the
 * stray tails are dropped.
 */
export function removeSelfIntersections(ring: Ring, maxPasses = 32): Ring {
  let cur = ring;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const n = cur.length;
    if (n < 4) return cur;

    // Every crossing splits the ring in two. Snip at the crossing whose
    // DISCARDED loop is smallest: that peels off the stray tails one at a time
    // and leaves the body the user drew intact. Taking the first crossing in
    // index order instead can lop a chunk off the main shape when a stroke
    // crosses itself more than once.
    let best: { keep: Ring; lost: number } | null = null;
    for (let i = 0; i < n; i += 1) {
      const a1 = cur[i];
      const a2 = cur[(i + 1) % n];
      for (let j = i + 2; j < n; j += 1) {
        if (i === 0 && j === n - 1) continue; // wrap-around neighbours
        const at = segmentCrossing(a1, a2, cur[j], cur[(j + 1) % n]);
        if (!at) continue;
        const loopA: Ring = [at, ...cur.slice(i + 1, j + 1)];
        const loopB: Ring = [at, ...cur.slice(j + 1), ...cur.slice(0, i + 1)];
        const areaA = Math.abs(signedArea(loopA));
        const areaB = Math.abs(signedArea(loopB));
        const keep = areaA >= areaB ? loopA : loopB;
        const lost = Math.min(areaA, areaB);
        if (keep.length >= 3 && (!best || lost < best.lost)) best = { keep, lost };
      }
    }
    if (!best) return cur;
    cur = best.keep;
  }
  return cur;
}

/** Simplify + de-loop + smooth a freehand ring; [] when the sketch is too small. */
export function smoothZonePolygon(raw: Ring, iterations = 2): Ring {
  let ring = simplify(raw);
  if (ring.length < 3) return [];
  // Before smoothing: Chaikin only pulls vertices inward, so a ring that is
  // simple here stays simple after it.
  ring = removeSelfIntersections(ring);
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
