/**
 * Can this medic actually sweep this course?
 *
 * Sweeping means staying with the last participant for the whole distance, on
 * the ground they are on. Two ways that goes wrong and both are worth saying
 * before the briefing rather than at 2 a.m. on the mountain: the vehicle cannot
 * use the terrain, or it cannot keep up with the back of the field.
 */

import { VEHICLE_TYPE_META, type VehicleType } from '@events/contracts'
import { haversineMeters, pointAtMeters, type CourseModel } from './course'
import { vehicleSpeedKmh } from './travel'

export type SweepWarningLevel = 'blocker' | 'caution'

export interface SweepWarning {
  level: SweepWarningLevel
  message: string
}

/** Discipline types whose course is trails and tracks, not road. */
const OFFROAD_TYPES = new Set(['trail-run', 'mtb'])

/** Metres of ascent per kilometre past which a course is mountain, whatever it is called. */
const MOUNTAIN_ASCENT_PER_KM = 15

/**
 * Short stretches of the course, spread along it, for asking the router "can
 * this vehicle actually cover this bit of ground?".
 *
 * Sampling beats any heuristic about discipline names: a race tagged as a road
 * bike event can still spend half its distance on forest singletrack, and only
 * the network knows.
 */
export function sampleChords(
  course: CourseModel,
  count = 4,
  chordMeters = 2000,
): Array<{ from: [number, number]; to: [number, number]; courseMeters: number }> {
  const out: Array<{ from: [number, number]; to: [number, number]; courseMeters: number }> = []
  if (course.totalMeters < chordMeters * 1.5) return out
  for (let i = 0; i < count; i += 1) {
    const start = course.totalMeters * (0.12 + (0.76 * i) / Math.max(1, count - 1))
    const end = Math.min(course.totalMeters, start + chordMeters)
    const from = pointAtMeters(course, start)
    const to = pointAtMeters(course, end)
    // A GPS gap in the GPX can put two kilometres of "course" between one pair
    // of coordinates; routing between a point and itself measures nothing, so
    // that sample is dropped rather than counted as a perfect score.
    if (haversineMeters(from, to) < 200) continue
    out.push({ from, to, courseMeters: end - start })
  }
  return out
}

/** How far the vehicle has to travel to cover a stretch the field walks. */
export interface SweepFit {
  /** Median routed distance ÷ course distance over the sampled chords. */
  detourRatio: number
  /** Chords the router could not connect at all. */
  unroutable: number
  sampled: number
}

export interface SweepCheckInput {
  vehicle: VehicleType
  disciplineName: string
  disciplineType: string
  distanceKm: number
  ascentMeters: number
  /** The cut-off, i.e. how long the back of the field takes. */
  slowestMinutes: number
  /** Measured on the network, when the samples have come back. */
  fit?: SweepFit
}

export function checkSweep(input: SweepCheckInput): SweepWarning[] {
  const meta = VEHICLE_TYPE_META[input.vehicle] ?? VEHICLE_TYPE_META.foot
  const warnings: SweepWarning[] = []

  const climbPerKm = input.distanceKm > 0 ? input.ascentMeters / input.distanceKm : 0
  const offroad = OFFROAD_TYPES.has(input.disciplineType) || climbPerKm >= MOUNTAIN_ASCENT_PER_KM

  // The measured answer, when there is one, outranks every heuristic below.
  if (input.fit && input.fit.sampled > 0) {
    const { detourRatio, unroutable, sampled } = input.fit
    if (unroutable >= Math.ceil(sampled / 2)) {
      warnings.push({
        level: 'blocker',
        message: `${meta.label} can't get onto ${input.disciplineName} at all over half the course — this is not a sweepable course for this vehicle.`,
      })
    } else if (detourRatio >= 2.5) {
      warnings.push({
        level: 'blocker',
        message: `${meta.label} can't follow ${input.disciplineName} — covering the course would mean ${detourRatio.toFixed(1)}× the distance on roads, so it cannot stay with the last participant.`,
      })
    } else if (detourRatio >= 1.6) {
      warnings.push({
        level: 'caution',
        message: `${meta.label} leaves the course to follow ${input.disciplineName} — about ${detourRatio.toFixed(1)}× the distance by road. It will not be beside the tail the whole way.`,
      })
    }
  } else if (offroad && !meta.offroad) {
    warnings.push({
      level: 'blocker',
      message: `${meta.label} can't follow ${input.disciplineName} — the field is on trails a road vehicle has no way onto. Sweep it on foot, a bike or something with clearance.`,
    })
  }

  // The back of the field, at the cut-off, across the whole course.
  if (input.slowestMinutes > 0 && input.distanceKm > 0) {
    const tailKmh = input.distanceKm / (input.slowestMinutes / 60)
    const vehicleKmh = vehicleSpeedKmh(input.vehicle)
    if (tailKmh > vehicleKmh) {
      warnings.push({
        level: 'blocker',
        message: `The back of ${input.disciplineName} averages ${tailKmh.toFixed(1)} km/h and a ${meta.label.toLowerCase()} sustains about ${vehicleKmh} — it will lose the tail.`,
      })
    } else if (tailKmh > vehicleKmh * 0.8) {
      warnings.push({
        level: 'caution',
        message: `Tight: the back of ${input.disciplineName} averages ${tailKmh.toFixed(1)} km/h, near this vehicle's sustainable pace.`,
      })
    }
  }

  return warnings
}
