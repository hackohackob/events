/**
 * Where the field is currently out of reach of a medic.
 *
 * Timing the disciplines shows you where the runners are; posting the medics
 * shows you where the help is. This is the subtraction of the two — the
 * stretches of course that have people on them and nobody within reach — which
 * is the actual question the whole planner exists to answer.
 */

import { haversineMeters, pointAtMeters, type CourseModel } from './course'
import type { FieldState } from './field'

/** Default reach: about what a vehicle covers on mountain roads in ten minutes. */
export const DEFAULT_COVERAGE_METERS = 3000

/** Coarse enough to stay cheap at 60 fps, fine enough to spot a real hole. */
const SAMPLE_METERS = 1000

export interface CoverageGap {
  /** Metres along the course. */
  fromMeters: number
  toMeters: number
  /** Geometry of the gap, for drawing. */
  coordinates: [number, number][]
}

export interface CoverageReport {
  /** Metres of occupied course with nobody in reach. */
  uncoveredMeters: number
  /** Metres of occupied course in total. */
  occupiedMeters: number
  gaps: CoverageGap[]
  /** The single worst stretch, or null when everything is covered. */
  worstGapMeters: number
}

export const EMPTY_COVERAGE: CoverageReport = {
  uncoveredMeters: 0,
  occupiedMeters: 0,
  gaps: [],
  worstGapMeters: 0,
}

/**
 * Walk the occupied stretch of a course and mark every kilometre that has no
 * medic within `radiusMeters`. Medics are taken at their position *now*,
 * including ones mid-move — a medic driving past a valley does cover it.
 */
export function coverageFor(
  course: CourseModel,
  field: FieldState,
  medicPositions: Array<[number, number]>,
  radiusMeters = DEFAULT_COVERAGE_METERS,
): CoverageReport {
  if (field.onCourse <= 0 || field.tailMeters < 0 || course.totalMeters <= 0) return EMPTY_COVERAGE

  const from = Math.max(0, field.tailMeters)
  const to = Math.min(course.totalMeters, Math.max(field.leaderMeters, field.tailMeters))
  const occupiedMeters = Math.max(0, to - from)
  if (occupiedMeters <= 0) return { ...EMPTY_COVERAGE, occupiedMeters: 0 }

  const gaps: CoverageGap[] = []
  let uncovered = 0
  let worst = 0
  let open: CoverageGap | null = null

  for (let m = from; m <= to; m += SAMPLE_METERS) {
    const point = pointAtMeters(course, m)
    let nearest = Number.POSITIVE_INFINITY
    for (const medic of medicPositions) {
      const d = haversineMeters(point, medic)
      if (d < nearest) nearest = d
      if (nearest <= radiusMeters) break
    }

    if (nearest > radiusMeters) {
      uncovered += Math.min(SAMPLE_METERS, to - m)
      if (open) {
        open.toMeters = m
        open.coordinates.push(point)
      } else {
        open = { fromMeters: m, toMeters: m, coordinates: [point] }
        gaps.push(open)
      }
    } else if (open) {
      worst = Math.max(worst, open.toMeters - open.fromMeters)
      open = null
    }
  }
  if (open) worst = Math.max(worst, open.toMeters - open.fromMeters)

  return {
    uncoveredMeters: Math.round(uncovered),
    occupiedMeters: Math.round(occupiedMeters),
    // A one-sample gap has no length yet still marks a hole; report the sample.
    gaps: gaps.filter(g => g.coordinates.length > 1),
    worstGapMeters: Math.round(worst),
  }
}
