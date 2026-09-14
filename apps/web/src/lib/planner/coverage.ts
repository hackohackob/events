/**
 * Where the field is currently out of reach of a medic.
 *
 * Timing the disciplines shows you where the runners are; posting the medics
 * shows you where the help is. This is the subtraction of the two — the
 * stretches of course that have people on them and nobody within reach — which
 * is the actual question the whole planner exists to answer.
 *
 * The result is reported two ways: as a per-bin series that paints the course
 * from green to red, and as the contiguous gap ranges that get called out.
 */

import { haversineMeters, pointAtMeters, type CourseModel } from './course'
import { DENSITY_BINS, type FieldState } from './field'

/** Default reach: about what a vehicle covers on mountain roads in ten minutes. */
export const DEFAULT_COVERAGE_METERS = 3000

export interface CoverageGap {
  /** Metres along the course. */
  fromMeters: number
  toMeters: number
  /** Geometry of the gap, for drawing. */
  coordinates: [number, number][]
}

export interface CoverageReport {
  /**
   * Per course bin (same binning as the field density), metres to the nearest
   * on-duty medic. `Infinity` when there is no medic at all.
   */
  nearest: number[]
  /** Per bin: is anyone actually on this stretch right now? */
  occupied: boolean[]
  /** Metres of occupied course with nobody in reach. */
  uncoveredMeters: number
  /** Metres of occupied course in total. */
  occupiedMeters: number
  gaps: CoverageGap[]
  /** The single worst stretch, 0 when everything occupied is covered. */
  worstGapMeters: number
}

export const EMPTY_COVERAGE: CoverageReport = {
  nearest: [],
  occupied: [],
  uncoveredMeters: 0,
  occupiedMeters: 0,
  gaps: [],
  worstGapMeters: 0,
}

/**
 * Measure the whole course bin by bin. Medics are taken at their position
 * *now*, including ones mid-move and ones sweeping — a medic driving past a
 * valley does cover it, and the sweeper covers the back of the field by
 * definition.
 */
export function coverageFor(
  course: CourseModel,
  field: FieldState,
  medicPositions: Array<[number, number]>,
  radiusMeters = DEFAULT_COVERAGE_METERS,
): CoverageReport {
  if (course.totalMeters <= 0) return EMPTY_COVERAGE

  const binMeters = course.totalMeters / DENSITY_BINS
  const nearest = new Array<number>(DENSITY_BINS).fill(Number.POSITIVE_INFINITY)
  const occupied = new Array<boolean>(DENSITY_BINS).fill(false)

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
    const point = pointAtMeters(course, atMeters)

    let best = Number.POSITIVE_INFINITY
    for (const medic of medicPositions) {
      const d = haversineMeters(point, medic)
      if (d < best) best = d
      // Anything this close is comfortably covered; no need to keep looking.
      if (best <= radiusMeters * 0.4) break
    }
    nearest[i] = best

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
    if (best > radiusMeters) {
      uncoveredMeters += binMeters
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
    nearest,
    occupied,
    uncoveredMeters: Math.round(uncoveredMeters),
    occupiedMeters: Math.round(occupiedMeters),
    gaps: gaps.filter(g => g.coordinates.length > 1),
    worstGapMeters: Math.round(worst),
  }
}
