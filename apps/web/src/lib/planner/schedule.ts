/**
 * Turns a medic's list of "be here at this time" stations into a timeline.
 *
 * The rule that makes the whole feature work: a station is an ARRIVAL. A medic
 * sent to base camp at 01:00 and to Point 1 at 06:00 does not drift across the
 * mountain for five hours — they sleep at base camp until 05:30 and drive the
 * last half hour. Every move is therefore anchored to its arrival and reaches
 * backwards by however long the trip takes.
 *
 * Two things bend that rule, and both are modelled here rather than bolted on:
 * a medic may swap vehicles partway through (so each leg is quoted on whatever
 * they are driving when it departs), and a medic may be sweeping a discipline
 * (so for that window their position is the back of the field, not a post).
 */

import type {
  PlanMedic,
  PlanStation,
  PlanSweepJoin,
  PlanTravelSource,
  VehicleType,
} from '@events/contracts'
import { planVehicleAt } from '@events/contracts'
import { haversineMeters } from './course'
import { estimateTravelMinutes } from './travel'

export type SegmentKind = 'hold' | 'move' | 'sweep'

export interface TimelineSegment {
  kind: SegmentKind
  fromMs: number
  toMs: number
  /** The station being held, the one being travelled to, or the sweep. */
  stationId: string
  label: string
  /** Move segments only. */
  from?: [number, number]
  to?: [number, number]
  /** Routed geometry when the router answered; a straight line otherwise. */
  path?: [number, number][]
  travelSource?: PlanTravelSource
  /** The vehicle this leg is driven on. */
  vehicleType?: VehicleType
  /** Sweep segments only: which discipline is being swept. */
  disciplineId?: string
  color?: string
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
  /** The full station list the timeline was built from, sweeps included. */
  stations: PlannedStation[]
}

/**
 * A discipline this medic sweeps, expanded into something the scheduler can
 * reason about: a window, its two endpoints on the course, and where the back
 * of the field is at any instant inside it.
 */
export interface SweepWindow {
  disciplineId: string
  label: string
  color: string
  /** The gun. Where a `start` sweeper joins. */
  gunMs: number
  /** When the last participant is off the course. */
  endMs: number
  courseStart: [number, number]
  endPoint: [number, number]
  /** Where the back of the field is at an instant. */
  positionAt: (atMs: number) => [number, number]
  /** When the back of the field reaches a point beside the course. */
  tailReaches: (point: [number, number]) => number
}

/**
 * A sweep, resolved against one medic's own postings.
 *
 * `post` sweeps have no fixed start: the medic works their post and becomes the
 * sweeper the moment the last participant reaches them, so the start time falls
 * out of the schedule rather than being typed in.
 */
export interface ResolvedSweep {
  disciplineId: string
  label: string
  color: string
  joinFrom: PlanSweepJoin
  /** When this medic joins the tail. */
  startMs: number
  endMs: number
  /** Where they join from. */
  startPoint: [number, number]
  endPoint: [number, number]
  positionAt: (atMs: number) => [number, number]
  /** The posting they wait at, when joining from one. */
  postStationId?: string
  postLabel?: string
  /** Set when `post` was asked for but no posting qualified. */
  fellBackToStart?: boolean
}

/**
 * Work out when and where a medic picks up the tail.
 *
 * For a post join the candidate is the latest posting the medic is already
 * standing at by the time the tail passes it — "I'm on Point 2 until the last
 * runner comes through, then I go with them". If nothing qualifies (every
 * posting is made after the tail has already gone by) the sweep falls back to
 * the gun, and says so, rather than quietly inventing a time.
 */
export function resolveSweep(
  medic: PlanMedic,
  window: SweepWindow,
  joinFrom: PlanSweepJoin,
): ResolvedSweep {
  const base: ResolvedSweep = {
    disciplineId: window.disciplineId,
    label: window.label,
    color: window.color,
    joinFrom,
    startMs: window.gunMs,
    endMs: window.endMs,
    startPoint: window.courseStart,
    endPoint: window.endPoint,
    positionAt: window.positionAt,
  }
  if (joinFrom === 'start') return base

  let best: { station: PlanStation; atMs: number } | null = null
  for (const station of medic.stations) {
    const arrive = ms(station.arriveAt)
    if (!Number.isFinite(arrive)) continue
    const passes = window.tailReaches([station.lng, station.lat])
    if (!Number.isFinite(passes) || passes > window.endMs) continue
    // They have to be standing there before the tail goes through.
    if (arrive > passes) continue
    if (!best || arrive > ms(best.station.arriveAt)) best = { station, atMs: passes }
  }

  if (!best) return { ...base, fellBackToStart: true }
  return {
    ...base,
    startMs: best.atMs,
    // They step onto the course from where they were standing, so the handover
    // is drawn at the post rather than jumping to the projected course point.
    startPoint: [best.station.lng, best.station.lat],
    postStationId: best.station.id,
    postLabel: best.station.label,
  }
}

/** A station as the scheduler sees it — a real posting, or a sweep endpoint. */
export interface PlannedStation extends PlanStation {
  /** Set on the two synthetic stations that bracket a sweep. */
  sweep?: { disciplineId: string; edge: 'start' | 'end'; joinFrom?: PlanSweepJoin }
  /**
   * No journey precedes this one — the medic is already standing here. Set on
   * the start of a sweep taken up from a post, where charging a minimum travel
   * time would invent a conflict out of thin air.
   */
  noTravel?: boolean
}

/** Routed geometries live in memory only — the plan stores durations, not shapes. */
export type PathLookup = (
  from: PlanStation,
  to: PlanStation,
  vehicle: VehicleType,
) => [number, number][] | undefined

export interface ResolveOptions {
  /** Floor for any move. Nobody relocates in under this, however close it is. */
  minTravelMinutes?: number
  paths?: PathLookup
  /**
   * Routed minutes for a leg, when the router has answered one. Consulted for
   * legs whose destination is synthetic (a sweep endpoint) and therefore has
   * nowhere on the stored plan to cache a duration.
   */
  durations?: (from: PlanStation, to: PlanStation, vehicle: VehicleType) => number | undefined
  /** Sweeps this medic is on, already resolved against the discipline schedules. */
  sweeps?: ResolvedSweep[]
}

export const DEFAULT_MIN_TRAVEL_MINUTES = 10

function ms(iso: string): number {
  return new Date(iso).getTime()
}

/** The vehicle the medic is on at an instant. Re-exported so callers need one import. */
export function vehicleAt(medic: PlanMedic, atMs: number): VehicleType {
  return planVehicleAt(medic, atMs)
}

/**
 * Every place the medic has to be, in order: their own postings plus the two
 * endpoints of each sweep. Sweep endpoints are synthetic — they exist so the
 * legs into and out of a sweep are costed like any other move.
 */
export function plannedStations(medic: PlanMedic, sweeps: ResolvedSweep[] = []): PlannedStation[] {
  const out: PlannedStation[] = medic.stations.filter(s => Number.isFinite(ms(s.arriveAt)))

  const synthetic: PlannedStation[] = []
  for (const sweep of sweeps) {
    const fromPost = sweep.joinFrom === 'post' && sweep.postStationId != null
    synthetic.push({
      id: `sweep:${sweep.disciplineId}:start`,
      arriveAt: new Date(sweep.startMs).toISOString(),
      lng: sweep.startPoint[0],
      lat: sweep.startPoint[1],
      label: fromPost ? `${sweep.label} tail` : `${sweep.label} start`,
      sweep: { disciplineId: sweep.disciplineId, edge: 'start', joinFrom: sweep.joinFrom },
      noTravel: fromPost || undefined,
    })
    synthetic.push({
      id: `sweep:${sweep.disciplineId}:end`,
      arriveAt: new Date(sweep.endMs).toISOString(),
      lng: sweep.endPoint[0],
      lat: sweep.endPoint[1],
      label: `${sweep.label} finish`,
      sweep: { disciplineId: sweep.disciplineId, edge: 'end' },
    })
  }

  // A posting that falls inside a sweep window is unreachable — the medic is on
  // the course. Dropping it here keeps the timeline honest instead of drawing a
  // medic in two places at once.
  const inSweep = (at: number) => sweeps.some(s => at > s.startMs && at < s.endMs)

  return [...out.filter(s => !inSweep(ms(s.arriveAt))), ...synthetic].sort(
    (a, b) => ms(a.arriveAt) - ms(b.arriveAt),
  )
}

/** Stations in the order they happen, sweeps included. */
export function sortedStations(medic: PlanMedic, sweeps: ResolvedSweep[] = []): PlannedStation[] {
  return plannedStations(medic, sweeps)
}

/**
 * Minutes budgeted for the leg into `to`. A number typed by the coordinator
 * wins; then whatever the router measured and cached onto the station; then a
 * crow-flies estimate for the vehicle being driven at the time.
 */
export function legMinutes(
  vehicle: VehicleType,
  from: PlanStation,
  to: PlanStation,
  minTravelMinutes = DEFAULT_MIN_TRAVEL_MINUTES,
  routedMinutes?: number,
): { minutes: number; source: PlanTravelSource } {
  if (to.travelMinutes != null && Number.isFinite(to.travelMinutes)) {
    // A duration the coordinator typed stands whatever they are driving; a
    // measured one is only good while they are still on the vehicle it was
    // measured for.
    if (to.travelSource === 'manual' || to.travelVehicle == null || to.travelVehicle === vehicle) {
      return {
        minutes: Math.max(minTravelMinutes, to.travelMinutes),
        source: to.travelSource ?? 'estimated',
      }
    }
  }
  if (routedMinutes != null && Number.isFinite(routedMinutes)) {
    return { minutes: Math.max(minTravelMinutes, routedMinutes), source: 'routed' }
  }
  const meters = haversineMeters([from.lng, from.lat], [to.lng, to.lat])
  return {
    minutes: Math.max(minTravelMinutes, estimateTravelMinutes(meters, vehicle)),
    source: 'estimated',
  }
}

/**
 * Which vehicle a leg is driven on: whatever the medic is on when they ARRIVE.
 *
 * The alternative — the vehicle at departure — is more literally true but
 * behaves badly: a swap to something slower pushes the computed departure
 * backwards, sometimes to before the swap itself, so picking a bike would
 * silently keep quoting the car. Keying on the arrival makes the rule the one a
 * planner means when they say "from here on they're on the bike": every leg
 * that lands after the swap is on the new vehicle, every leg that landed before
 * it keeps the old one.
 */
export function legVehicle(
  medic: PlanMedic,
  _from: PlanStation,
  to: PlanStation,
  _minTravelMinutes: number,
): VehicleType {
  return vehicleAt(medic, ms(to.arriveAt))
}

/** Build the full hold/move/sweep timeline for one medic. */
export function resolveMedicTimeline(medic: PlanMedic, options: ResolveOptions = {}): MedicTimeline {
  const minTravel = options.minTravelMinutes ?? DEFAULT_MIN_TRAVEL_MINUTES
  const sweeps = options.sweeps ?? []
  const stations = plannedStations(medic, sweeps)
  const segments: TimelineSegment[] = []
  const conflicts: MedicTimeline['conflicts'] = []
  let travelMinutes = 0
  let moveCount = 0

  if (stations.length === 0) {
    return {
      planMedicId: medic.id,
      segments,
      onDutyFromMs: null,
      offDutyAtMs: null,
      moveCount: 0,
      travelMinutes: 0,
      conflicts,
      stations,
    }
  }

  const sweepFor = (station: PlannedStation) =>
    station.sweep ? sweeps.find(s => s.disciplineId === station.sweep!.disciplineId) : undefined

  for (let i = 1; i < stations.length; i += 1) {
    const prev = stations[i - 1]
    const station = stations[i]
    const prevArrive = ms(prev.arriveAt)
    const arrive = ms(station.arriveAt)

    // Between a sweep's two endpoints the medic is ON the course, riding the
    // back of the field — not travelling between two posts.
    if (station.sweep?.edge === 'end' && prev.sweep?.edge === 'start') {
      const sweep = sweepFor(station)
      segments.push({
        kind: 'sweep',
        fromMs: prevArrive,
        toMs: arrive,
        stationId: station.id,
        label: sweep?.label ?? station.label,
        disciplineId: station.sweep.disciplineId,
        color: sweep?.color,
        from: [prev.lng, prev.lat],
        to: [station.lng, station.lat],
      })
      continue
    }

    if (station.noTravel) {
      // Standing still until the tail arrives: one continuous hold at the post,
      // no journey and therefore no minimum travel time to fall foul of.
      if (arrive - prevArrive >= 60000) {
        segments.push({
          kind: 'hold',
          fromMs: prevArrive,
          toMs: arrive,
          stationId: prev.id,
          label: prev.label,
          to: [prev.lng, prev.lat],
        })
      }
      continue
    }

    const vehicle = legVehicle(medic, prev, station, minTravel)
    const leg = legMinutes(vehicle, prev, station, minTravel, options.durations?.(prev, station, vehicle))

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
      path: options.paths?.(prev, station, vehicle),
      travelSource: leg.source,
      vehicleType: vehicle,
      tight,
      shortfallMinutes: tight ? shortfallMinutes : undefined,
    })
    moveCount += 1
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
    moveCount,
    travelMinutes: Math.round(travelMinutes),
    conflicts,
    stations,
  }
}

export type MedicPhase = 'off-duty' | 'holding' | 'moving' | 'sweeping'

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
  /** Sweeping only. */
  disciplineId?: string
  vehicleType?: VehicleType
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
  atMs: number,
  sweeps: ResolvedSweep[] = [],
): MedicPosition | null {
  const stations = timeline.stations
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

    if (segment.kind === 'sweep') {
      const sweep = sweeps.find(s => s.disciplineId === segment.disciplineId)
      return {
        phase: 'sweeping',
        position: sweep ? sweep.positionAt(atMs) : (segment.from ?? [first.lng, first.lat]),
        stationId: segment.stationId,
        label: segment.label,
        disciplineId: segment.disciplineId,
        nextEventInMinutes: Math.round((segment.toMs - atMs) / 60000),
      }
    }

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
      vehicleType: segment.vehicleType,
    }
  }

  const last = stations[stations.length - 1]
  return { phase: 'holding', position: [last.lng, last.lat], stationId: last.id, label: last.label }
}
