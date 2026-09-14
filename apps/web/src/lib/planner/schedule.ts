/**
 * Turns a medic's list of "be here at this time" stations into a timeline.
 *
 * The rule that makes the whole feature work: a station is an ARRIVAL. A medic
 * sent to base camp at 01:00 and to Point 1 at 06:00 does not drift across the
 * mountain for five hours — they sleep at base camp until 05:30 and drive the
 * last half hour. Every move is therefore anchored to its arrival and reaches
 * backwards by however long the trip takes.
 */

import type { PlanMedic, PlanStation, PlanTravelSource } from '@events/contracts'
import { haversineMeters } from './course'
import { estimateTravelMinutes } from './travel'

export type SegmentKind = 'hold' | 'move'

export interface TimelineSegment {
  kind: SegmentKind
  fromMs: number
  toMs: number
  /** The station being held, or the one being travelled to. */
  stationId: string
  label: string
  /** Move segments only. */
  from?: [number, number]
  to?: [number, number]
  /** Routed geometry when the router answered; a straight line otherwise. */
  path?: [number, number][]
  travelSource?: PlanTravelSource
  /**
   * The arrival could not be met from the previous station in the time
   * available — the move is drawn compressed and flagged in the UI.
   */
  tight?: boolean
  /** Minutes the medic is short by, when `tight`. */
  shortfallMinutes?: number
}

export interface MedicTimeline {
  planMedicId: string
  segments: TimelineSegment[]
  /** Epoch ms the medic first has to be somewhere; `null` with no stations. */
  onDutyFromMs: number | null
  offDutyAtMs: number | null
  moveCount: number
  travelMinutes: number
  /** Arrivals that cannot physically be met. */
  conflicts: Array<{ stationId: string; shortfallMinutes: number }>
}

/** Routed geometries live in memory only — the plan stores durations, not shapes. */
export type PathLookup = (from: PlanStation, to: PlanStation) => [number, number][] | undefined

export interface ResolveOptions {
  /** Floor for any move. Nobody relocates in under this, however close it is. */
  minTravelMinutes?: number
  paths?: PathLookup
}

export const DEFAULT_MIN_TRAVEL_MINUTES = 10

function ms(iso: string): number {
  return new Date(iso).getTime()
}

/** Stations in the order they happen. The planner never trusts array order. */
export function sortedStations(medic: PlanMedic): PlanStation[] {
  return [...medic.stations]
    .filter(s => Number.isFinite(ms(s.arriveAt)))
    .sort((a, b) => ms(a.arriveAt) - ms(b.arriveAt))
}

/**
 * Minutes budgeted for the leg into `to`. A number typed by the coordinator
 * wins; then whatever the router measured and cached onto the station; then a
 * crow-flies estimate for the vehicle.
 */
export function legMinutes(
  medic: PlanMedic,
  from: PlanStation,
  to: PlanStation,
  minTravelMinutes = DEFAULT_MIN_TRAVEL_MINUTES,
): { minutes: number; source: PlanTravelSource } {
  if (to.travelMinutes != null && Number.isFinite(to.travelMinutes)) {
    return {
      minutes: Math.max(minTravelMinutes, to.travelMinutes),
      source: to.travelSource ?? 'estimated',
    }
  }
  const meters = haversineMeters([from.lng, from.lat], [to.lng, to.lat])
  return {
    minutes: Math.max(minTravelMinutes, estimateTravelMinutes(meters, medic.vehicleType)),
    source: 'estimated',
  }
}

/** Build the full hold/move timeline for one medic. */
export function resolveMedicTimeline(medic: PlanMedic, options: ResolveOptions = {}): MedicTimeline {
  const minTravel = options.minTravelMinutes ?? DEFAULT_MIN_TRAVEL_MINUTES
  const stations = sortedStations(medic)
  const segments: TimelineSegment[] = []
  const conflicts: MedicTimeline['conflicts'] = []
  let travelMinutes = 0

  if (stations.length === 0) {
    return {
      planMedicId: medic.id,
      segments,
      onDutyFromMs: null,
      offDutyAtMs: null,
      moveCount: 0,
      travelMinutes: 0,
      conflicts,
    }
  }

  for (let i = 1; i < stations.length; i += 1) {
    const prev = stations[i - 1]
    const station = stations[i]
    const prevArrive = ms(prev.arriveAt)
    const arrive = ms(station.arriveAt)
    const leg = legMinutes(medic, prev, station, minTravel)

    let departure = arrive - leg.minutes * 60000
    let tight = false
    let shortfallMinutes = 0
    if (departure < prevArrive) {
      // The two arrivals are closer together than the journey between them.
      shortfallMinutes = Math.round((prevArrive - departure) / 60000)
      departure = prevArrive
      tight = true
      conflicts.push({ stationId: station.id, shortfallMinutes })
    }

    // A hold shorter than a minute is a rounding artefact, not a stay.
    if (departure - prevArrive >= 60000) {
      segments.push({
        kind: 'hold',
        fromMs: prevArrive,
        toMs: departure,
        stationId: prev.id,
        label: prev.label,
        to: [prev.lng, prev.lat],
      })
    }

    segments.push({
      kind: 'move',
      fromMs: departure,
      toMs: arrive,
      stationId: station.id,
      label: station.label,
      from: [prev.lng, prev.lat],
      to: [station.lng, station.lat],
      path: options.paths?.(prev, station),
      travelSource: leg.source,
      tight,
      shortfallMinutes: tight ? shortfallMinutes : undefined,
    })
    travelMinutes += Math.max(0, (arrive - departure) / 60000)
  }

  // The final station is held open-ended; the caller clips it to the plan end.
  const last = stations[stations.length - 1]
  segments.push({
    kind: 'hold',
    fromMs: ms(last.arriveAt),
    toMs: Number.POSITIVE_INFINITY,
    stationId: last.id,
    label: last.label,
    to: [last.lng, last.lat],
  })

  return {
    planMedicId: medic.id,
    segments,
    onDutyFromMs: ms(stations[0].arriveAt),
    offDutyAtMs: ms(last.arriveAt),
    moveCount: Math.max(0, stations.length - 1),
    travelMinutes: Math.round(travelMinutes),
    conflicts,
  }
}

export type MedicPhase = 'off-duty' | 'holding' | 'moving'

export interface MedicPosition {
  phase: MedicPhase
  position: [number, number]
  /** The station being held, or travelled to. */
  stationId: string
  label: string
  /** Move only: 0…1 along the leg. */
  progress?: number
  /** Move only: the leg's geometry, for drawing the trace. */
  path?: [number, number][]
  /** Minutes until the next arrival, when moving; until departure, when holding. */
  nextEventInMinutes?: number
  nextLabel?: string
  tight?: boolean
}

/** Ease the drawn motion a little — a vehicle that starts and stops instantly
 *  reads as a glitch. Blended half-and-half with linear so the clock stays honest. */
function easeAlong(t: number): number {
  const smooth = t * t * (3 - 2 * t)
  return t * 0.5 + smooth * 0.5
}

function walkPath(path: [number, number][], fraction: number): [number, number] {
  if (path.length === 0) return [0, 0]
  if (path.length === 1) return path[0]
  let total = 0
  const steps: number[] = [0]
  for (let i = 1; i < path.length; i += 1) {
    total += haversineMeters(path[i - 1], path[i])
    steps.push(total)
  }
  if (total <= 0) return path[0]
  const target = total * Math.max(0, Math.min(1, fraction))
  for (let i = 1; i < steps.length; i += 1) {
    if (steps[i] >= target) {
      const span = steps[i] - steps[i - 1]
      const t = span > 0 ? (target - steps[i - 1]) / span : 0
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
      ]
    }
  }
  return path[path.length - 1]
}

/** Where the medic is at `atMs`, and what they are doing. */
export function medicPositionAt(
  timeline: MedicTimeline,
  stations: PlanStation[],
  atMs: number,
): MedicPosition | null {
  if (stations.length === 0) return null
  const first = stations[0]

  if (timeline.onDutyFromMs != null && atMs < timeline.onDutyFromMs) {
    return {
      phase: 'off-duty',
      position: [first.lng, first.lat],
      stationId: first.id,
      label: first.label,
      nextEventInMinutes: Math.round((timeline.onDutyFromMs - atMs) / 60000),
      nextLabel: first.label,
    }
  }

  for (const segment of timeline.segments) {
    if (atMs < segment.fromMs || atMs > segment.toMs) continue
    if (segment.kind === 'hold') {
      const finite = Number.isFinite(segment.toMs)
      return {
        phase: 'holding',
        position: segment.to ?? [first.lng, first.lat],
        stationId: segment.stationId,
        label: segment.label,
        nextEventInMinutes: finite ? Math.round((segment.toMs - atMs) / 60000) : undefined,
      }
    }
    const span = Math.max(1, segment.toMs - segment.fromMs)
    const raw = (atMs - segment.fromMs) / span
    const eased = easeAlong(Math.max(0, Math.min(1, raw)))
    const from = segment.from ?? [0, 0]
    const to = segment.to ?? from
    const position = segment.path && segment.path.length > 1
      ? walkPath(segment.path, eased)
      : ([from[0] + (to[0] - from[0]) * eased, from[1] + (to[1] - from[1]) * eased] as [number, number])
    return {
      phase: 'moving',
      position,
      stationId: segment.stationId,
      label: segment.label,
      progress: raw,
      path: segment.path,
      nextEventInMinutes: Math.round((segment.toMs - atMs) / 60000),
      nextLabel: segment.label,
      tight: segment.tight,
    }
  }

  const last = stations[stations.length - 1]
  return { phase: 'holding', position: [last.lng, last.lat], stationId: last.id, label: last.label }
}
