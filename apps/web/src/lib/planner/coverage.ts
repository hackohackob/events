/**
 * Where the field is currently out of reach of a medic.
 *
 * Timing the disciplines shows you where the runners are; posting the medics
 * shows you where the help is. This is the subtraction of the two — the
 * stretches of course that have people on them and nobody who can get there in
 * time — which is the actual question the whole planner exists to answer.
 *
 * Reach is expressed as a RATIO, not a distance: 0 is on top of a medic, 1 is
 * the edge of the reach budget, above that is out. That lets a routed isochrone
 * (bucket 2 of 3 → 0.67) and a crow-flies fallback (2.1 km of a 3 km radius →
 * 0.7) feed the same scale and the same colour ramp.
 */

import { haversineMeters, pointAtMeters, type CourseModel } from './course'
import { DENSITY_BINS, type FieldState } from './field'

/** Default reach: ten minutes, which is the usual "someone is with you" target. */
export const DEFAULT_REACH_MINUTES = 10

/** Ratio assigned to a bin no medic can reach at all. */
const OUT_OF_REACH = 2.2

export interface CoverageMedic {
  position: [number, number]
  /** Per-bin reach buckets from a routed isochrone (1 = innermost). */
  buckets?: Uint8Array
  /** How many buckets the isochrone was cut into. */
  bucketCount?: number
  /**
   * A sweeper is ON this course, so their road IS the course: reach is measured
   * as distance along it from where they are, not as a shape around them.
   * `[metresAlongCourse, metresOfReach]`.
   */
  alongCourse?: [number, number]
  /** Last resort for a position nothing has been measured near, metres. */
  radiusMeters: number
}

export interface CoverageGap {
  fromMeters: number
  toMeters: number
  coordinates: [number, number][]
}

export interface CoverageReport {
  /** Per bin: 0 = on top of a medic, 1 = edge of reach, above = out. */
  ratio: number[]
  /** Per bin: is anyone actually on this stretch right now? */
  occupied: boolean[]
  uncoveredMeters: number
  occupiedMeters: number
  gaps: CoverageGap[]
  worstGapMeters: number
  /** True when at least one medic was measured on the network, not by radius. */
  routed: boolean
}

export const EMPTY_COVERAGE: CoverageReport = {
  ratio: [],
  occupied: [],
  uncoveredMeters: 0,
  occupiedMeters: 0,
  gaps: [],
  worstGapMeters: 0,
  routed: false,
}

export function coverageFor(
  course: CourseModel,
  field: FieldState,
  medics: CoverageMedic[],
): CoverageReport {
  if (course.totalMeters <= 0) return EMPTY_COVERAGE

  const binMeters = course.totalMeters / DENSITY_BINS
  const ratio = new Array<number>(DENSITY_BINS).fill(OUT_OF_REACH)
  const occupied = new Array<boolean>(DENSITY_BINS).fill(false)
  const routed = medics.some(m => m.buckets != null || m.alongCourse != null)

  const hasField = field.onCourse > 0 && field.tailMeters >= 0
  const fieldFrom = hasField ? Math.max(0, field.tailMeters) : 0
  const fieldTo = hasField ? Math.max(field.leaderMeters, field.tailMeters) : 0

  let uncoveredMeters = 0
  let occupiedMeters = 0
  const gaps: CoverageGap[] = []
  let open: CoverageGap | null = null
  let worst = 0

  for (let i = 0; i < DENSITY_BINS; i += 1) {
    const atMeters = (i + 0.5) * binMeters
    let best = OUT_OF_REACH

    for (const medic of medics) {
      let value: number
      if (medic.alongCourse) {
        const [atCourseMeters, reach] = medic.alongCourse
        value = reach > 0 ? Math.abs(atMeters - atCourseMeters) / reach : OUT_OF_REACH
      } else if (medic.buckets) {
        const bucket = medic.buckets[i]
        const count = medic.bucketCount ?? 3
        value = bucket === 0 ? OUT_OF_REACH : bucket / count
      } else {
        const point = pointAtMeters(course, atMeters)
        value = medic.radiusMeters > 0
          ? haversineMeters(point, medic.position) / medic.radiusMeters
          : OUT_OF_REACH
      }
      if (value < best) best = value
      if (best <= 0.34) break
    }
    ratio[i] = best

    const isOccupied = hasField && atMeters >= fieldFrom && atMeters <= fieldTo
    occupied[i] = isOccupied
    if (!isOccupied) {
      if (open) {
        worst = Math.max(worst, open.toMeters - open.fromMeters)
        open = null
      }
      continue
    }

    occupiedMeters += binMeters
    if (best > 1) {
      uncoveredMeters += binMeters
      const point = pointAtMeters(course, atMeters)
      if (open) {
        open.toMeters = atMeters
        open.coordinates.push(point)
      } else {
        open = { fromMeters: atMeters, toMeters: atMeters, coordinates: [point] }
        gaps.push(open)
      }
    } else if (open) {
      worst = Math.max(worst, open.toMeters - open.fromMeters)
      open = null
    }
  }
  if (open) worst = Math.max(worst, open.toMeters - open.fromMeters)

  return {
    ratio,
    occupied,
    uncoveredMeters: Math.round(uncoveredMeters),
    occupiedMeters: Math.round(occupiedMeters),
    gaps: gaps.filter(g => g.coordinates.length > 1),
    worstGapMeters: Math.round(worst),
    routed,
  }
}
