'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  EventPlan,
  PlanDisciplineSchedule,
  PlanMedic,
  PlanStation,
  VehicleType,
} from '@events/contracts'
import {
  EMPTY_EVENT_PLAN,
  normalizeVehicleType,
  planMedicColor,
  planSweeps,
  planVehicleAt,
} from '@events/contracts'
import { fetchEventById, type ApiEventSummary } from '@/api/events'
import { getMedicRoster } from '@/api/medics'
import { fetchIsochrone, fetchPlan, routeLeg, savePlan } from '@/api/plan'
import { fetchGpxTrack } from '@/lib/gpx'
import {
  buildCourse,
  haversineMeters,
  nearestOnCourse,
  pointAtMeters,
  timeFractionAtMeters,
  type CourseModel,
} from '@/lib/planner/course'
import { buildFieldShape, fieldAt, scheduleEndMs, type FieldShape } from '@/lib/planner/field'
import {
  DEFAULT_MIN_TRAVEL_MINUTES,
  legVehicle,
  plannedStations,
  resolveSweep,
  type ResolvedSweep,
  type SweepWindow,
} from '@/lib/planner/schedule'
import { estimateTravelMinutes } from '@/lib/planner/travel'
import { buildReachShape, reachKey, type ReachShape } from '@/lib/planner/isochrone'
import { sampleChords, type SweepFit } from '@/lib/planner/sweep-check'
import type { PointOfInterest, POIType } from '@/lib/types'

// ─── Defaults ────────────────────────────────────────────────────────────────

/** Minutes per km a *winner* covers, by discipline type. Starting points only —
 *  every one of these is a field the coordinator overrides in one click. */
const WINNER_PACE_MIN_PER_KM: Record<string, number> = {
  'trail-run': 5.4,
  run: 3.6,
  marathon: 3.4,
  mtb: 2.6,
  bike: 1.9,
  swim: 18,
}

/** Cut-off as a multiple of the winner's time — how races are actually written. */
const CUTOFF_MULTIPLIER = 2.6

/** Default start: 08:00 local on the discipline's own day. */
function defaultStartAt(dayDate: string): string {
  const [y, m, d] = dayDate.split('-').map(Number)
  const at = new Date(y || 2026, (m || 1) - 1, d || 1, 8, 0, 0, 0)
  return at.toISOString()
}

function defaultSchedule(input: {
  id: string
  dayDate: string
  type: string
  distanceKm: number
  ascentMeters: number
}): PlanDisciplineSchedule {
  const pace = WINNER_PACE_MIN_PER_KM[input.type] ?? WINNER_PACE_MIN_PER_KM['trail-run']
  // Climbing costs roughly a minute per 100 m for the sharp end of the field.
  const climb = (input.ascentMeters || 0) / 100
  const fastest = Math.max(20, Math.round(input.distanceKm * pace + climb))
  return {
    id: input.id,
    startAt: defaultStartAt(input.dayDate),
    fastestMinutes: fastest,
    slowestMinutes: Math.round(fastest * CUTOFF_MULTIPLIER),
    pacing: 'terrain',
  }
}

export const SNAP_METERS_DEFAULT = 120

// ─── Derived shapes ──────────────────────────────────────────────────────────

export interface PlannerDiscipline {
  id: string
  name: string
  dayDate: string
  type: string
  color: string
  distanceKm: number
  ascentMeters: number
  course: CourseModel
  schedule: PlanDisciplineSchedule
  shape: FieldShape
  /** False while the GPX is still downloading, or when there is none. */
  hasCourse: boolean
}

export interface PlanHistory {
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

/** Stable id for a discipline — the plan keys its schedule off this. */
export function disciplineKey(dayDate: string, name: string): string {
  return `${dayDate}::${name}`
}

function legKey(from: { lat: number; lng: number }, to: { lat: number; lng: number }, vehicle: string): string {
  const r = (n: number) => n.toFixed(5)
  return `${r(from.lng)},${r(from.lat)}>${r(to.lng)},${r(to.lat)}:${vehicle}`
}

// ─── The hook ────────────────────────────────────────────────────────────────

export function usePlanner(eventId: string, options: { reachMinutes: number }) {
  const { reachMinutes } = options
  const eventQuery = useQuery({
    queryKey: ['events', eventId],
    queryFn: () => fetchEventById(eventId),
    enabled: !!eventId,
  })
  const rosterQuery = useQuery({
    queryKey: ['plan-roster', eventId],
    queryFn: () => getMedicRoster(eventId),
    enabled: !!eventId,
    staleTime: 60_000,
  })
  const planQuery = useQuery({
    queryKey: ['plan', eventId],
    queryFn: () => fetchPlan(eventId),
    enabled: !!eventId,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  })

  const event: ApiEventSummary | undefined = eventQuery.data

  // ── Plan document + undo history ────────────────────────────────────────
  const [plan, setPlanState] = useState<EventPlan | null>(null)
  const past = useRef<EventPlan[]>([])
  const future = useRef<EventPlan[]>([])
  const [historyTick, setHistoryTick] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const lastSaved = useRef<string>('')

  useEffect(() => {
    if (!planQuery.data || plan) return
    const loaded = { ...EMPTY_EVENT_PLAN, ...planQuery.data }
    planRef.current = loaded
    setPlanState(loaded)
    lastSaved.current = JSON.stringify(planQuery.data)
  }, [planQuery.data, plan])

  /**
   * Every edit goes through here so undo/redo and autosave stay honest.
   *
   * The next document is computed from a ref rather than inside the state
   * updater: React may run an updater twice (StrictMode, and any re-render it
   * decides to discard), and an updater that also pushes onto the undo stack
   * would then record the same edit twice — leaving undo needing two presses
   * for one change.
   */
  const planRef = useRef<EventPlan | null>(null)
  planRef.current = plan

  const mutate = useCallback(
    (updater: (current: EventPlan) => EventPlan, options: { silent?: boolean } = {}) => {
      const current = planRef.current
      if (!current) return
      const next = updater(current)
      if (next === current) return
      if (!options.silent) {
        past.current = [...past.current.slice(-49), current]
        future.current = []
        setHistoryTick(t => t + 1)
      }
      planRef.current = next
      setPlanState(next)
      setSaveState('dirty')
    },
    [],
  )

  const undo = useCallback(() => {
    const current = planRef.current
    const previous = past.current.pop()
    if (!current || !previous) return
    future.current = [current, ...future.current.slice(0, 49)]
    planRef.current = previous
    setPlanState(previous)
    setHistoryTick(t => t + 1)
    setSaveState('dirty')
  }, [])

  const redo = useCallback(() => {
    const current = planRef.current
    const [next, ...rest] = future.current
    if (!current || !next) return
    future.current = rest
    past.current = [...past.current, current]
    planRef.current = next
    setPlanState(next)
    setHistoryTick(t => t + 1)
    setSaveState('dirty')
  }, [])

  const history: PlanHistory = useMemo(
    () => ({ canUndo: past.current.length > 0, canRedo: future.current.length > 0, undo, redo }),
    // historyTick is the whole point: the refs above don't trigger renders.
    [historyTick, undo, redo],
  )

  // ── Autosave ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!plan || !eventId) return
    const serialised = JSON.stringify({ ...plan, updatedAt: '' })
    if (serialised === lastSaved.current) return
    const timer = setTimeout(() => {
      setSaveState('saving')
      savePlan(eventId, plan)
        .then(() => {
          lastSaved.current = serialised
          setSaveState('saved')
        })
        .catch(() => setSaveState('error'))
    }, 900)
    return () => clearTimeout(timer)
  }, [plan, eventId])

  // ── Courses (GPX) ───────────────────────────────────────────────────────
  const [courses, setCourses] = useState<Record<string, CourseModel>>({})
  const disciplineRows = useMemo(() => {
    const rows: Array<{
      id: string
      dayDate: string
      name: string
      type: string
      color: string
      distanceKm: number
      ascentMeters: number
      gpxUrl?: string
    }> = []
    for (const day of event?.days ?? []) {
      for (const disc of day.disciplines ?? []) {
        rows.push({
          id: disciplineKey(day.date, disc.name),
          dayDate: day.date,
          name: disc.name,
          type: disc.type,
          color: disc.color,
          distanceKm: disc.distanceKm,
          ascentMeters: disc.ascentMeters,
          gpxUrl: disc.gpxUrl,
        })
      }
    }
    return rows
  }, [event])

  useEffect(() => {
    const pending = disciplineRows.filter(d => d.gpxUrl)
    if (pending.length === 0) return
    let cancelled = false
    Promise.all(
      pending.map(async row => {
        const track = await fetchGpxTrack(row.gpxUrl!)
        return { id: row.id, course: buildCourse(track.coordinates, track.elevations ?? []) }
      }),
    ).then(results => {
      if (cancelled) return
      const next: Record<string, CourseModel> = {}
      for (const r of results) next[r.id] = r.course
      setCourses(next)
    })
    return () => {
      cancelled = true
    }
  }, [disciplineRows])

  // Seed a schedule for any discipline the plan hasn't got one for yet.
  useEffect(() => {
    if (!plan || disciplineRows.length === 0) return
    const missing = disciplineRows.filter(row => !plan.disciplines.some(d => d.id === row.id))
    if (missing.length === 0) return
    mutate(
      current => ({
        ...current,
        disciplines: [...current.disciplines, ...missing.map(defaultSchedule)],
      }),
      { silent: true },
    )
  }, [plan, disciplineRows, mutate])

  const disciplines: PlannerDiscipline[] = useMemo(() => {
    if (!plan) return []
    return disciplineRows.map(row => {
      const schedule =
        plan.disciplines.find(d => d.id === row.id) ?? defaultSchedule(row)
      const course = courses[row.id] ?? buildCourse([], [])
      return {
        ...row,
        course,
        schedule,
        shape: buildFieldShape(schedule),
        hasCourse: course.coordinates.length > 1,
      }
    })
  }, [plan, disciplineRows, courses])

  // ── Points of interest (snap targets) ───────────────────────────────────
  const pois: PointOfInterest[] = useMemo(() => {
    const list: PointOfInterest[] = []
    for (const day of event?.days ?? []) {
      for (const poi of day.pois ?? []) {
        if (poi.archived) continue
        list.push({
          id: poi.id ?? `${poi.lng},${poi.lat}`,
          type: poi.type as POIType,
          coordinates: [poi.lng, poi.lat],
          name: poi.name,
          description: poi.description,
          icon: poi.icon,
        })
      }
    }
    return list
  }, [event])

  const snapMeters = plan?.settings?.snapMeters ?? SNAP_METERS_DEFAULT
  const minTravelMinutes = plan?.settings?.minTravelMinutes ?? DEFAULT_MIN_TRAVEL_MINUTES

  /** The POI a dropped position should stick to, if any is close enough. */
  const snapTarget = useCallback(
    (lngLat: [number, number]): PointOfInterest | null => {
      let best: PointOfInterest | null = null
      let bestDistance = snapMeters
      for (const poi of pois) {
        const d = haversineMeters(poi.coordinates, lngLat)
        if (d <= bestDistance) {
          best = poi
          bestDistance = d
        }
      }
      return best
    },
    [pois, snapMeters],
  )

  // ── Plan medics, seeded from the roster ─────────────────────────────────
  useEffect(() => {
    if (!plan || !rosterQuery.data || rosterQuery.data.length === 0) return
    const missing = rosterQuery.data.filter(m => !plan.medics.some(p => p.medicId === m.id))
    if (missing.length === 0) return
    mutate(
      current => ({
        ...current,
        medics: [
          ...current.medics,
          ...missing.map<PlanMedic>(m => ({
            id: `pm-${m.id}`,
            medicId: m.id,
            name: m.name,
            unit: m.unit,
            vehicleType: normalizeVehicleType(m.vehicleType),
            color: planMedicColor(m.id),
            stations: [],
          })),
        ],
      }),
      { silent: true },
    )
  }, [plan, rosterQuery.data, mutate])

  const medics = plan?.medics ?? []

  // ── Sweeps ──────────────────────────────────────────────────────────────
  /**
   * Each discipline expanded into a sweepable window. Lives here rather than in
   * the view because the routing pass below has to cost the legs into and out
   * of a sweep, which means it needs to know where those endpoints are.
   */
  const sweepWindows = useMemo(() => {
    const out: Record<string, SweepWindow> = {}
    for (const d of disciplines) {
      if (!d.hasCourse) continue
      const gunMs = new Date(d.schedule.startAt).getTime()
      if (!Number.isFinite(gunMs)) continue
      const coords = d.course.coordinates
      const terrain = (d.schedule.pacing ?? 'terrain') === 'terrain'
      const waveOffset = d.schedule.startWindowMinutes ?? 0
      out[d.id] = {
        disciplineId: d.id,
        label: d.name,
        color: d.color,
        gunMs,
        endMs: scheduleEndMs(d.schedule),
        courseStart: coords[0],
        endPoint: coords[coords.length - 1],
        positionAt: (atMs: number) => {
          const state = fieldAt(d.schedule, d.shape, d.course, atMs)
          if (state.onCourse <= 0 || state.tailMeters < 0) {
            return atMs <= gunMs ? coords[0] : coords[coords.length - 1]
          }
          return pointAtMeters(d.course, state.tailMeters)
        },
        // The back of the field is the slowest runner: off last in a waved
        // start, and taking the full cut-off to cover the whole course. That
        // makes the pass time a direct calculation rather than a search.
        tailReaches: (point: [number, number]) => {
          const { meters } = nearestOnCourse(d.course, point)
          const fraction = timeFractionAtMeters(d.course, meters, terrain)
          return gunMs + (waveOffset + d.schedule.slowestMinutes * fraction) * 60000
        },
      }
    }
    return out
  }, [disciplines])

  const sweepsFor = useCallback(
    (medic: PlanMedic): ResolvedSweep[] =>
      planSweeps(medic)
        .map(assignment => {
          const window = sweepWindows[assignment.disciplineId]
          return window ? resolveSweep(medic, window, assignment.joinFrom) : null
        })
        .filter((s): s is ResolvedSweep => s != null)
        .sort((a, b) => a.startMs - b.startMs),
    [sweepWindows],
  )

  // ── Routed leg measurement ──────────────────────────────────────────────
  // Straight-line estimates appear instantly; the router upgrades them in the
  // background and the timeline re-flows when each answer lands.
  const pathCache = useRef<Map<string, [number, number][]>>(new Map())
  /** Routed minutes per leg. Kept in memory because a sweep endpoint has no
   *  station in the stored plan to hang a duration off. */
  const durationCache = useRef<Map<string, number>>(new Map())
  const inFlight = useRef<Set<string>>(new Set())
  /** Legs already put to the router. Keyed by endpoints + vehicle, so a moved
   *  station or a re-vehicled medic is a new key and gets measured again — but
   *  a leg the router could not answer is never asked twice. */
  const attempted = useRef<Set<string>>(new Set())
  const [pathTick, setPathTick] = useState(0)

  useEffect(() => {
    if (!plan || !eventId) return
    let cancelled = false

    const jobs: Array<{
      medic: PlanMedic
      from: PlanStation
      to: PlanStation
      vehicle: VehicleType
      key: string
    }> = []
    for (const medic of plan.medics) {
      const sweeps = sweepsFor(medic)
      const stations = plannedStations(medic, sweeps)
      for (let i = 1; i < stations.length; i += 1) {
        const from = stations[i - 1]
        const to = stations[i]
        // The stretch between a sweep's own two endpoints is the course itself,
        // not a relocation — nothing to route.
        if (from.sweep?.edge === 'start' && to.sweep?.edge === 'end') continue
        const vehicle = legVehicle(medic, from, to, minTravelMinutes)
        const key = legKey(from, to, vehicle)
        if (!attempted.current.has(key) && !inFlight.current.has(key)) {
          jobs.push({ medic, from, to, vehicle, key })
        }
      }
    }
    if (jobs.length === 0) return

    // Serial on purpose: a planner dragging a puck around would otherwise fire
    // a dozen routing calls a second at the shared GraphHopper instance.
    void (async () => {
      for (const job of jobs) {
        if (cancelled) return
        inFlight.current.add(job.key)
        const routed = await routeLeg(eventId, job.from, job.to, job.vehicle)
        inFlight.current.delete(job.key)
        attempted.current.add(job.key)
        if (cancelled) return
        if (!routed) {
          // No router (or no route): fall back to the crow-flies estimate and a
          // straight line, both already good enough to plan against.
          const meters = haversineMeters([job.from.lng, job.from.lat], [job.to.lng, job.to.lat])
          const minutes = Math.max(minTravelMinutes, estimateTravelMinutes(meters, job.vehicle))
          pathCache.current.set(job.key, [
            [job.from.lng, job.from.lat],
            [job.to.lng, job.to.lat],
          ])
          durationCache.current.set(job.key, minutes)
          mutate(
            current => applyLegResult(current, job.medic.id, job.to.id, minutes, 'estimated', job.vehicle),
            { silent: true },
          )
          setPathTick(t => t + 1)
          continue
        }
        pathCache.current.set(job.key, routed.path)
        durationCache.current.set(job.key, Math.max(minTravelMinutes, routed.minutes))
        mutate(
          current =>
            applyLegResult(
              current,
              job.medic.id,
              job.to.id,
              Math.max(minTravelMinutes, routed.minutes),
              'routed',
              job.vehicle,
            ),
          { silent: true },
        )
        setPathTick(t => t + 1)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [plan, eventId, mutate, minTravelMinutes, sweepsFor])

  const pathLookup = useCallback(
    (from: PlanStation, to: PlanStation, vehicle: VehicleType) =>
      pathCache.current.get(legKey(from, to, vehicle)),
    // pathTick forces consumers to re-resolve once a route lands.
    [pathTick],
  )

  const durationLookup = useCallback(
    (from: PlanStation, to: PlanStation, vehicle: VehicleType) =>
      durationCache.current.get(legKey(from, to, vehicle)),
    [pathTick],
  )

  // ── Reach (routed isochrones) ───────────────────────────────────────────
  //
  // Only postings are measured on the network: they are where a medic actually
  // stands, they are few, and they do not move while the clock runs. A medic in
  // transit or riding a sweep falls back to a radius — there is no sensible way
  // to ask the router about a position that changes every frame.
  const reachCache = useRef<Map<string, ReachShape>>(new Map())
  const reachAttempted = useRef<Set<string>>(new Set())
  const [reachTick, setReachTick] = useState(0)

  useEffect(() => {
    if (!plan || !eventId || !Number.isFinite(reachMinutes)) return
    let cancelled = false

    const jobs: Array<{ point: [number, number]; vehicle: VehicleType; key: string }> = []
    for (const medic of plan.medics) {
      if (medic.hidden) continue
      for (const station of medic.stations) {
        const vehicle = planVehicleAt(medic, new Date(station.arriveAt).getTime())
        const point: [number, number] = [station.lng, station.lat]
        const key = reachKey(point, vehicle, reachMinutes)
        if (reachAttempted.current.has(key)) continue
        if (jobs.some(j => j.key === key)) continue
        jobs.push({ point, vehicle, key })
      }
    }
    if (jobs.length === 0) return

    void (async () => {
      for (const job of jobs) {
        if (cancelled) return
        reachAttempted.current.add(job.key)
        const result = await fetchIsochrone(
          eventId,
          { lat: job.point[1], lng: job.point[0] },
          job.vehicle,
          reachMinutes,
        )
        if (cancelled) return
        if (result) reachCache.current.set(job.key, buildReachShape(result.polygons))
        setReachTick(t => t + 1)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [plan, eventId, reachMinutes])

  const reachShapeFor = useCallback(
    (point: [number, number], vehicle: VehicleType): ReachShape | undefined =>
      reachCache.current.get(reachKey(point, vehicle, reachMinutes)),
    [reachMinutes, reachTick],
  )

  // ── Can the sweeper's vehicle follow the course? ────────────────────────
  //
  // Measured, not guessed: a handful of two-kilometre stretches of the course
  // are routed on the vehicle's own network and compared against the course
  // distance. A vehicle that has to drive eight kilometres of road to cover two
  // kilometres of trail is not sweeping anything.
  const fitCache = useRef<Map<string, SweepFit>>(new Map())
  const fitAttempted = useRef<Set<string>>(new Set())
  const [fitTick, setFitTick] = useState(0)

  useEffect(() => {
    if (!plan || !eventId) return
    let cancelled = false

    const jobs: Array<{ key: string; course: CourseModel; vehicle: VehicleType }> = []
    for (const medic of plan.medics) {
      for (const sweep of planSweeps(medic)) {
        const discipline = disciplines.find(d => d.id === sweep.disciplineId)
        if (!discipline?.hasCourse) continue
        const startMs = new Date(discipline.schedule.startAt).getTime()
        const vehicle = planVehicleAt(medic, startMs)
        const key = `${sweep.disciplineId}:${vehicle}`
        if (fitAttempted.current.has(key) || jobs.some(j => j.key === key)) continue
        jobs.push({ key, course: discipline.course, vehicle })
      }
    }
    if (jobs.length === 0) return

    void (async () => {
      for (const job of jobs) {
        if (cancelled) return
        fitAttempted.current.add(job.key)
        const chords = sampleChords(job.course)
        if (chords.length === 0) continue
        const ratios: number[] = []
        let unroutable = 0
        for (const chord of chords) {
          const routed = await routeLeg(
            eventId,
            { lat: chord.from[1], lng: chord.from[0] },
            { lat: chord.to[1], lng: chord.to[0] },
            job.vehicle,
          )
          if (cancelled) return
          // A zero-length answer means both ends snapped to the same node —
          // the vehicle has no way onto this stretch, not a perfect score.
          if (!routed || routed.meters <= 50) unroutable += 1
          else ratios.push(routed.meters / chord.courseMeters)
        }
        const sorted = [...ratios].sort((a, b) => a - b)
        fitCache.current.set(job.key, {
          detourRatio: sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : Number.POSITIVE_INFINITY,
          unroutable,
          sampled: chords.length,
        })
        setFitTick(t => t + 1)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [plan, eventId, disciplines])

  const sweepFitFor = useCallback(
    (disciplineId: string, vehicle: VehicleType): SweepFit | undefined =>
      fitCache.current.get(`${disciplineId}:${vehicle}`),
    [fitTick],
  )

  // ── Timeline bounds ─────────────────────────────────────────────────────
  const bounds = useMemo(() => {
    const stamps: number[] = []
    for (const d of disciplines) {
      if (d.schedule.enabled === false) continue
      const start = new Date(d.schedule.startAt).getTime()
      if (Number.isFinite(start)) {
        stamps.push(start)
        stamps.push(scheduleEndMs(d.schedule))
      }
    }
    for (const medic of medics) {
      for (const station of medic.stations) {
        const at = new Date(station.arriveAt).getTime()
        if (Number.isFinite(at)) stamps.push(at)
      }
      const standDown = medic.standDownAt ? new Date(medic.standDownAt).getTime() : NaN
      if (Number.isFinite(standDown)) stamps.push(standDown)
    }
    if (stamps.length === 0) {
      const dates = event?.dates ?? []
      const first = dates[0] ? new Date(`${dates[0]}T06:00:00`) : new Date()
      const last = dates[dates.length - 1] ? new Date(`${dates[dates.length - 1]}T22:00:00`) : new Date()
      return { fromMs: first.getTime(), toMs: Math.max(last.getTime(), first.getTime() + 12 * 3600_000) }
    }
    const HOUR = 3600_000
    const min = Math.min(...stamps) - 2 * HOUR
    const max = Math.max(...stamps) + 2 * HOUR
    return {
      fromMs: Math.floor(min / HOUR) * HOUR,
      toMs: Math.max(Math.ceil(max / HOUR) * HOUR, Math.floor(min / HOUR) * HOUR + 6 * HOUR),
    }
  }, [disciplines, medics, event])

  return {
    event,
    loading: eventQuery.isLoading || planQuery.isLoading,
    error: eventQuery.error ?? planQuery.error,
    plan,
    mutate,
    history,
    saveState,
    disciplines,
    medics,
    roster: rosterQuery.data ?? [],
    pois,
    snapTarget,
    snapMeters,
    minTravelMinutes,
    pathLookup,
    durationLookup,
    reachShapeFor,
    sweepFitFor,
    sweepWindows,
    sweepsFor,
    bounds,
  }
}

/** Write a measured leg onto its station without disturbing anything else. */
function applyLegResult(
  plan: EventPlan,
  planMedicId: string,
  stationId: string,
  minutes: number,
  source: 'routed' | 'estimated',
  vehicle: VehicleType,
): EventPlan {
  let changed = false
  const medics = plan.medics.map(medic => {
    if (medic.id !== planMedicId) return medic
    let medicChanged = false
    const stations = medic.stations.map(station => {
      if (station.id !== stationId) return station
      // Never overwrite a duration the coordinator typed in themselves.
      if (station.travelSource === 'manual') return station
      if (
        station.travelMinutes === minutes &&
        station.travelSource === source &&
        station.travelVehicle === vehicle
      ) {
        return station
      }
      medicChanged = true
      return { ...station, travelMinutes: minutes, travelSource: source, travelVehicle: vehicle }
    })
    if (!medicChanged) return medic
    changed = true
    return { ...medic, stations }
  })
  return changed ? { ...plan, medics } : plan
}
