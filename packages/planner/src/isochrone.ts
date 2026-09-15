/**
 * Reach measured along the road network instead of across country.
 *
 * A medic three kilometres away with a ridge in between covers nothing; one
 * twelve kilometres away down a good valley road covers plenty. A radius cannot
 * tell those apart, so reach is taken from GraphHopper isochrones — nested
 * polygons of everywhere the vehicle can actually get to inside a time budget —
 * and each course is indexed against them once, when the polygons arrive.
 */

import { pointAtMeters, type CourseModel } from './course'
import { DENSITY_BINS } from './field'

export type Ring = [number, number][]

type Bounds = [number, number, number, number]

export interface ReachShape {
  /**
   * Innermost bucket first. A bucket holds one ring per network the vehicle can
   * use — an ATV rides both the track network and the trails — so a point is
   * reachable in that bucket if ANY of its rings contains it.
   */
  buckets: Ring[][]
  /** `[minLng, minLat, maxLng, maxLat]` per ring — the cheap rejection test. */
  bounds: Bounds[][]
}

function ringBounds(ring: Ring): Bounds {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng
    if (lat < minLat) minLat = lat
    if (lng > maxLng) maxLng = lng
    if (lat > maxLat) maxLat = lat
  }
  return [minLng, minLat, maxLng, maxLat]
}

export function buildReachShape(buckets: Ring[][]): ReachShape {
  return { buckets, bounds: buckets.map(rings => rings.map(ringBounds)) }
}

/** How many buckets this shape was cut into. */
export function bucketCount(shape: ReachShape): number {
  return shape.buckets.length
}

/** Even-odd ray cast. The ring is assumed closed (GeoJSON always is). */
function pointInRing(point: [number, number], ring: Ring): boolean {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * How far off the routable network a medic still covers.
 *
 * GraphHopper builds an isochrone polygon as a hull of reachable NODES, so
 * along a road with no side branches it degenerates to a ribbon barely wider
 * than the road itself. A course running twenty metres to the side of that road
 * then tests as out of reach, which is nonsense — the medic parks and walks.
 * Every bin that misses is therefore retested on a small ring around itself.
 */
export const ACCESS_TOLERANCE_METERS = 120

/** Eight compass offsets at the tolerance, in degrees, for a given latitude. */
function toleranceOffsets(lat: number): Array<[number, number]> {
  const dLat = ACCESS_TOLERANCE_METERS / 111_320
  const dLng = ACCESS_TOLERANCE_METERS / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)))
  const diag = Math.SQRT1_2
  return [
    [dLng, 0],
    [-dLng, 0],
    [0, dLat],
    [0, -dLat],
    [dLng * diag, dLat * diag],
    [dLng * diag, -dLat * diag],
    [-dLng * diag, dLat * diag],
    [-dLng * diag, -dLat * diag],
  ]
}

/**
 * Which reach bucket each course bin falls in: 1 for the innermost (quickest)
 * polygon, up to `rings.length`, and 0 for bins nobody can get to in time.
 *
 * Computed once per shape per course — the polygons only change when a medic is
 * moved or the reach budget is, never while the clock runs.
 */
export function bucketsForCourse(course: CourseModel, shape: ReachShape): Uint8Array {
  const out = new Uint8Array(DENSITY_BINS)
  if (course.totalMeters <= 0 || shape.buckets.length === 0) return out
  const binMeters = course.totalMeters / DENSITY_BINS

  const bucketAt = (point: [number, number]): number => {
    for (let k = 0; k < shape.buckets.length; k += 1) {
      const rings = shape.buckets[k]
      for (let r = 0; r < rings.length; r += 1) {
        const [minLng, minLat, maxLng, maxLat] = shape.bounds[k][r]
        if (point[0] < minLng || point[0] > maxLng || point[1] < minLat || point[1] > maxLat) continue
        if (pointInRing(point, rings[r])) return k + 1
      }
    }
    return 0
  }

  for (let i = 0; i < DENSITY_BINS; i += 1) {
    const point = pointAtMeters(course, (i + 0.5) * binMeters)
    let bucket = bucketAt(point)
    if (bucket === 0) {
      // Just off the ribbon: try a short step in each direction and take the
      // best answer any of them finds.
      for (const [dx, dy] of toleranceOffsets(point[1])) {
        const found = bucketAt([point[0] + dx, point[1] + dy])
        if (found !== 0 && (bucket === 0 || found < bucket)) bucket = found
      }
    }
    out[i] = bucket
  }
  return out
}

/**
 * Does this shape actually contain the point it was measured from?
 *
 * An isochrone is computed from wherever GraphHopper SNAPPED the request, not
 * from the point asked for. Ask from a hillside and it answers about whatever
 * lane it found nearby — sometimes a dead end that reaches nothing, sometimes a
 * trunk road that reaches everything. Either way the answer is not about the
 * place asked about, and a shape that fails this test is thrown away.
 */
export function shapeContains(shape: ReachShape, point: [number, number]): boolean {
  const outer = shape.buckets.length - 1
  if (outer < 0) return false
  const test = (p: [number, number]) =>
    shape.buckets[outer].some((ring, r) => {
      const [minLng, minLat, maxLng, maxLat] = shape.bounds[outer][r]
      if (p[0] < minLng || p[0] > maxLng || p[1] < minLat || p[1] > maxLat) return false
      return pointInRing(p, ring)
    })
  if (test(point)) return true
  return toleranceOffsets(point[1]).some(([dx, dy]) => test([point[0] + dx, point[1] + dy]))
}

/** Cache key for a reach shape. Rounded so a nudged pin reuses its isochrone. */
export function reachKey(point: [number, number], vehicle: string, minutes: number): string {
  return `${point[0].toFixed(4)},${point[1].toFixed(4)}:${vehicle}:${minutes}`
}
