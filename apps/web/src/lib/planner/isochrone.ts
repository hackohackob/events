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

export interface ReachShape {
  /** Innermost bucket first; the last ring is the full time budget. */
  rings: Ring[]
  /** `[minLng, minLat, maxLng, maxLat]` per ring — the cheap rejection test. */
  bounds: Array<[number, number, number, number]>
}

export function buildReachShape(rings: Ring[]): ReachShape {
  return {
    rings,
    bounds: rings.map(ring => {
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
      return [minLng, minLat, maxLng, maxLat] as [number, number, number, number]
    }),
  }
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
  if (course.totalMeters <= 0 || shape.rings.length === 0) return out
  const binMeters = course.totalMeters / DENSITY_BINS

  const bucketAt = (point: [number, number]): number => {
    for (let r = 0; r < shape.rings.length; r += 1) {
      const [minLng, minLat, maxLng, maxLat] = shape.bounds[r]
      if (point[0] < minLng || point[0] > maxLng || point[1] < minLat || point[1] > maxLat) continue
      if (pointInRing(point, shape.rings[r])) return r + 1
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

/** Cache key for a reach shape. Rounded so a nudged pin reuses its isochrone. */
export function reachKey(point: [number, number], vehicle: string, minutes: number): string {
  return `${point[0].toFixed(4)},${point[1].toFixed(4)}:${vehicle}:${minutes}`
}
