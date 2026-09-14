/**
 * Where the field is, at any instant, for one discipline.
 *
 * The planner models the field as a fixed set of virtual runners whose finish
 * times are spread between the winner's time and the cut-off. That is enough to
 * answer the only question a medic planner actually asks — "at 03:00, which
 * stretch of this course still has people on it, and how many?" — without
 * pretending to know any individual's pace.
 */

import type { PlanDisciplineSchedule } from '@events/contracts'
import { metersAtTimeFraction, pointAtMeters, type CourseModel } from './course'

/** Virtual runners per discipline. 160 is smooth at 60 fps and cheap. */
const FIELD_SAMPLES = 160
/** Density bins along the course — also the number of gradient stops drawn. */
export const DENSITY_BINS = 96

/**
 * Finish-time distribution shape, mapping a uniform `p` to its share of the
 * window between the winner and the cut-off. A blend of a symmetric bell and a
 * mild right skew: most of a real field lands in the middle, with a long tail
 * of people walking it in just under the cut-off.
 */
function finishShape(p: number): number {
  const bell = 0.5 - 0.5 * Math.cos(Math.PI * p)
  const skew = Math.pow(p, 1.25)
  return 0.62 * bell + 0.38 * skew
}

export interface FieldRunner {
  /** Metres along the course, or -1 when not started / finished. */
  meters: number
}

export interface FieldState {
  /** Runners currently between the start and the finish. */
  onCourse: number
  finished: number
  notStarted: number
  /** Expected starters this state was scaled to. */
  total: number
  /** Front and back of the on-course pack, metres. -1 when nobody is out. */
  leaderMeters: number
  tailMeters: number
  /** `DENSITY_BINS` values in 0…1, front of course first. */
  density: number[]
  /** A thinned set of runner positions, for drawing dots. */
  dots: [number, number][]
}

export const EMPTY_FIELD: FieldState = {
  onCourse: 0,
  finished: 0,
  notStarted: 0,
  total: 0,
  leaderMeters: -1,
  tailMeters: -1,
  density: new Array<number>(DENSITY_BINS).fill(0),
  dots: [],
}

/** Cached per-runner finish/offset minutes — they only change with the schedule. */
export interface FieldShape {
  finishMinutes: number[]
  startOffsetMinutes: number[]
}

export function buildFieldShape(schedule: PlanDisciplineSchedule): FieldShape {
  const window = Math.max(0, schedule.slowestMinutes - schedule.fastestMinutes)
  const waveSpread = Math.max(0, schedule.startWindowMinutes ?? 0)
  const finishMinutes = new Array<number>(FIELD_SAMPLES)
  const startOffsetMinutes = new Array<number>(FIELD_SAMPLES)
  for (let k = 0; k < FIELD_SAMPLES; k += 1) {
    const p = k / (FIELD_SAMPLES - 1)
    finishMinutes[k] = schedule.fastestMinutes + window * finishShape(p)
    // Waves go off fastest-first, which is how every race seeds them.
    startOffsetMinutes[k] = waveSpread * p
  }
  return { finishMinutes, startOffsetMinutes }
}

/** How many dots to draw on the map — enough to read as a field, few enough to stay smooth. */
const DOT_STRIDE = 4

/**
 * Evaluate the field at `atMs`.
 *
 * `density` is normalised against an absolute reference (an even spread would
 * read ~0.12), not against the current peak — so the colour of a stretch means
 * the same thing at 06:00 as it does at 02:00 instead of re-scaling every frame.
 */
export function fieldAt(
  schedule: PlanDisciplineSchedule,
  shape: FieldShape,
  course: CourseModel,
  atMs: number,
): FieldState {
  const startMs = new Date(schedule.startAt).getTime()
  if (!Number.isFinite(startMs) || course.totalMeters <= 0) return EMPTY_FIELD

  const terrain = (schedule.pacing ?? 'terrain') === 'terrain'
  const elapsedMin = (atMs - startMs) / 60000
  const counts = new Array<number>(DENSITY_BINS).fill(0)
  const dots: [number, number][] = []

  let onCourse = 0
  let finished = 0
  let notStarted = 0
  let leaderMeters = -1
  let tailMeters = -1

  for (let k = 0; k < shape.finishMinutes.length; k += 1) {
    const own = elapsedMin - shape.startOffsetMinutes[k]
    if (own < 0) {
      notStarted += 1
      continue
    }
    const fraction = own / shape.finishMinutes[k]
    if (fraction >= 1) {
      finished += 1
      continue
    }
    onCourse += 1
    const meters = metersAtTimeFraction(course, fraction, terrain)
    if (leaderMeters < 0 || meters > leaderMeters) leaderMeters = meters
    if (tailMeters < 0 || meters < tailMeters) tailMeters = meters
    const bin = Math.min(
      DENSITY_BINS - 1,
      Math.max(0, Math.floor((meters / course.totalMeters) * DENSITY_BINS)),
    )
    counts[bin] += 1
    if (k % DOT_STRIDE === 0) dots.push(pointAtMeters(course, meters))
  }

  // Three-tap smoothing so a bin boundary never shows as a seam in the gradient.
  const smoothed = counts.map((c, i) => {
    const prev = counts[i - 1] ?? c
    const next = counts[i + 1] ?? c
    return (prev + 2 * c + next) / 4
  })

  const samples = shape.finishMinutes.length
  const reference = (samples / DENSITY_BINS) * 4
  const density = smoothed.map(c => Math.min(1, c / Math.max(1e-6, reference)))

  const total = schedule.participants && schedule.participants > 0 ? schedule.participants : samples
  const scale = total / samples

  return {
    onCourse: Math.round(onCourse * scale),
    finished: Math.round(finished * scale),
    notStarted: Math.round(notStarted * scale),
    total,
    leaderMeters,
    tailMeters,
    density,
    dots,
  }
}

/** The instant the last runner is off the course, per this schedule. */
export function scheduleEndMs(schedule: PlanDisciplineSchedule): number {
  const start = new Date(schedule.startAt).getTime()
  return start + (schedule.slowestMinutes + (schedule.startWindowMinutes ?? 0)) * 60000
}
