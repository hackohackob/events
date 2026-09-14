'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  CloudOff,
  Layers,
  Loader2,
  Redo2,
  ShieldAlert,
  Sparkles,
  Undo2,
  Users,
  X,
} from 'lucide-react'
import type {
  PlanDisciplineSchedule,
  PlanMedic,
  PlanStation,
  PlanSweepJoin,
  VehicleType,
} from '@events/contracts'
import { planMedicColor, planSweeps, planVehicleAt } from '@events/contracts'
import { usePlanner } from '@/hooks/usePlanner'
import type { BaseLayer } from '@/lib/map-styles'
import { fieldAt, EMPTY_FIELD, type FieldState } from '@/lib/planner/field'
import {
  medicPositionAt,
  resolveMedicTimeline,
  type MedicTimeline,
  type ResolveOptions,
  type ResolvedSweep,
} from '@/lib/planner/schedule'
import { formatTime } from '@/lib/planner/itinerary'
import {
  coverageFor,
  DEFAULT_REACH_MINUTES,
  EMPTY_COVERAGE,
  type CoverageMedic,
  type CoverageReport,
} from '@/lib/planner/coverage'

import { checkSweep, type SweepWarning } from '@/lib/planner/sweep-check'
import { bucketCount } from '@/lib/planner/isochrone'
import { splitRouteAtVias } from '@/lib/planner/route-segments'
import { haversineMeters, nearestOnCourse } from '@/lib/planner/course'
import { vehicleSpeedKmh } from '@/lib/planner/travel'
import { POI_CONFIGS, MAP_CENTER } from '@/lib/constants'
import PlannerMap, { type PlannedMedicView } from './PlannerMap'
import PlannerTimeline, { type PlaySpeed } from './PlannerTimeline'
import CoursePanel from './CoursePanel'
import TeamPanel from './TeamPanel'
import BriefingPanel from './BriefingPanel'

const TABS = ['course', 'team', 'briefing'] as const
type Tab = (typeof TABS)[number]

const TAB_LABEL: Record<Tab, string> = {
  course: 'Course',
  team: 'Team',
  briefing: 'Briefing',
}

/** Arrivals land on a five-minute grid — nobody briefs "arrive 09:07". */
const TIME_GRID_MS = 5 * 60_000

/** How far along their own course a sweeper is credited with covering. */
const SWEEP_ALONG_COURSE_CAP_METERS = 3000

export default function PlannerShell({ eventId }: { eventId: string }) {
  const [showCoverage, setShowCoverage] = useState(true)
  const [reachMinutes, setReachMinutes] = useState(DEFAULT_REACH_MINUTES)
  const planner = usePlanner(eventId, { reachMinutes })
  const {
    plan,
    mutate,
    disciplines,
    medics,
    bounds,
    snapTarget,
    pathLookup,
    durationLookup,
    reachAnchorsNear,
    reachBuckets,
    sweepFitFor,
    sweepsFor,
    minTravelMinutes,
  } = planner

  const [tab, setTab] = useState<Tab>('course')
  const [cursorMs, setCursorMs] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<PlaySpeed>(300)
  const [selectedMedicId, setSelectedMedicId] = useState<string | null>(null)
  const [hiddenDisciplineIds, setHiddenDisciplineIds] = useState<Set<string>>(new Set())
  const [baseLayer, setBaseLayer] = useState<BaseLayer>('terrain')
  const [showDensity, setShowDensity] = useState(true)
  const [showRunners, setShowRunners] = useState(true)
  const [timelineCollapsed, setTimelineCollapsed] = useState(false)
  const [fitBounds, setFitBounds] = useState<[[number, number], [number, number]] | undefined>()

  // Park the playhead on the first start — but only once the event has loaded.
  // Seeding it from the fallback bounds would leave the clock on today's date
  // for an event that runs next May, which reads as a bug the moment you look.
  useEffect(() => {
    if (cursorMs != null || !planner.event || !plan) return
    const firstStart = disciplines
      .map(d => new Date(d.schedule.startAt).getTime())
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0]
    if (firstStart == null && disciplines.length > 0) return
    setCursorMs(firstStart ?? bounds.fromMs)
  }, [cursorMs, bounds.fromMs, disciplines, planner.event, plan])

  const cursor = cursorMs ?? bounds.fromMs

  // ── Playback ──────────────────────────────────────────────────────────────
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let previous = performance.now()
    const step = (now: number) => {
      const delta = (now - previous) * speed
      previous = now
      const next = cursorRef.current + delta
      if (next >= bounds.toMs) {
        setCursorMs(bounds.toMs)
        setPlaying(false)
        return
      }
      setCursorMs(next)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, bounds.toMs])

  // ── Derived state at the playhead ─────────────────────────────────────────
  const fields = useMemo(() => {
    const out: Record<string, FieldState> = {}
    for (const d of disciplines) {
      out[d.id] =
        d.schedule.enabled === false || !d.hasCourse
          ? EMPTY_FIELD
          : fieldAt(d.schedule, d.shape, d.course, cursor)
    }
    return out
  }, [disciplines, cursor])

  const sweepColors = useMemo(() => {
    const out: Record<string, string> = {}
    for (const d of disciplines) out[d.id] = d.color
    return out
  }, [disciplines])

  const resolveOptionsFor = useCallback(
    (medic: PlanMedic): ResolveOptions => ({
      minTravelMinutes,
      paths: (from, to, vehicle) => pathLookup(from, to, vehicle),
      durations: (from, to, vehicle) => durationLookup(from, to, vehicle),
      sweeps: sweepsFor(medic),
    }),
    [minTravelMinutes, pathLookup, durationLookup, sweepsFor],
  )

  const timelines = useMemo(() => {
    const out: Record<string, MedicTimeline> = {}
    for (const medic of medics) out[medic.id] = resolveMedicTimeline(medic, resolveOptionsFor(medic))
    return out
  }, [medics, resolveOptionsFor])

  const medicViews: PlannedMedicView[] = useMemo(
    () =>
      medics.map(medic => {
        const timeline = timelines[medic.id]
        return {
          medic,
          vehicleType: planVehicleAt(medic, cursor),
          position: medicPositionAt(timeline, cursor, sweepsFor(medic)),
          routePoints: timeline.stations.map(s => ({
            id: s.id,
            lng: s.lng,
            lat: s.lat,
            label: s.label,
            arriveMs: new Date(s.arriveAt).getTime(),
          })),
          legs: timeline.segments
            .filter(seg => seg.kind === 'move')
            .map(seg => {
              const station = timeline.stations.find(st => st.id === seg.stationId)
              const via = station?.via ?? []
              const path =
                seg.path && seg.path.length > 1
                  ? seg.path
                  : ([seg.from, seg.to].filter(Boolean) as [number, number][])
              return { stationId: seg.stationId, via, segments: splitRouteAtVias(path, via) }
            }),
        }
      }),
    [medics, timelines, cursor, sweepsFor],
  )

  /**
   * Reach analysis, per course.
   *
   * Every medic on the board is measured the same way, whether they are parked
   * or driving: the nearest isochrone anchor to where they are. Journeys carry
   * anchors of their own, so coverage no longer lurches the moment someone
   * arrives somewhere. A sweeper is the one exception — they are ON the course,
   * so their reach runs along it rather than radiating from it.
   */
  const coverage = useMemo(() => {
    const out: Record<string, CoverageReport> = {}
    if (!showCoverage) return out

    const onDuty = medicViews.filter(
      v => !v.medic.hidden && v.position && v.position.phase !== 'off-duty',
    )

    for (const d of disciplines) {
      if (!d.hasCourse || hiddenDisciplineIds.has(d.id)) {
        out[d.id] = EMPTY_COVERAGE
        continue
      }
      const medicsHere: CoverageMedic[] = onDuty.flatMap(v => {
        const position = v.position!.position
        const reachMeters = (vehicleSpeedKmh(v.vehicleType) * 1000 * reachMinutes) / 60

        // A sweeper is on this course, so the course is their road: they reach
        // along it whatever the terrain around it does. That runs alongside the
        // routed shape rather than replacing it — everywhere else they can get
        // to still has to be measured on the network like anyone else.
        const sweepingHere =
          v.position!.phase === 'sweeping' && v.position!.disciplineId === d.id
        const alongCourse: [number, number] | undefined = sweepingHere
          ? [
              nearestOnCourse(d.course, position).meters,
              // Capped deliberately. This term exists to say "the sweeper is
              // with the tail", not to claim a valley at open-road speed on
              // ground the vehicle crawls over. Anything beyond it has to be
              // earned from the isochrone, which measures the real ways.
              Math.min(reachMeters, SWEEP_ALONG_COURSE_CAP_METERS),
            ]
          : undefined

        const anchors = reachAnchorsNear(position, v.vehicleType)
        return [
          {
            position,
            radiusMeters: reachMeters,
            alongCourse,
            measures: anchors.map(anchor => ({
              buckets: reachBuckets(d.id, d.course, anchor.key, anchor.shape),
              bucketCount: bucketCount(anchor.shape),
            })),
          },
        ]
      })
      out[d.id] = coverageFor(d.course, fields[d.id] ?? EMPTY_FIELD, medicsHere)
    }
    return out
  }, [
    showCoverage,
    medicViews,
    disciplines,
    fields,
    hiddenDisciplineIds,
    reachMinutes,
    reachAnchorsNear,
    reachBuckets,
  ])

  /**
   * Whether each medic's vehicle can actually do the sweep they are down for.
   * Checked against the course they would be following, not the one they are
   * nearest — a car marked to sweep a mountain trail is a plan that fails on
   * the night.
   */
  const sweepWarningsFor = useCallback(
    (medic: PlanMedic, disciplineId: string): SweepWarning[] => {
      const discipline = disciplines.find(d => d.id === disciplineId)
      if (!discipline) return []
      // Checked against the vehicle they are on when they actually pick the
      // tail up, which for a post join is not the gun.
      const sweep = sweepsFor(medic).find(w => w.disciplineId === disciplineId)
      const atMs = sweep?.startMs ?? new Date(discipline.schedule.startAt).getTime()
      const vehicle = planVehicleAt(medic, atMs)
      return checkSweep({
        vehicle,
        fit: sweepFitFor(disciplineId, planVehicleAt(medic, new Date(discipline.schedule.startAt).getTime())),
        disciplineName: discipline.name,
        disciplineType: discipline.type,
        distanceKm: discipline.distanceKm,
        ascentMeters: discipline.ascentMeters,
        slowestMinutes: discipline.schedule.slowestMinutes,
      })
    },
    [disciplines, sweepsFor, sweepFitFor],
  )

  // ── Plan edits ────────────────────────────────────────────────────────────
  const patchSchedule = useCallback(
    (id: string, patch: Partial<PlanDisciplineSchedule>) => {
      mutate(current => ({
        ...current,
        disciplines: current.disciplines.map(d => (d.id === id ? { ...d, ...patch } : d)),
      }))
    },
    [mutate],
  )

  const patchMedic = useCallback(
    (id: string, patch: Partial<PlanMedic>) => {
      mutate(current => ({
        ...current,
        medics: current.medics.map(m => (m.id === id ? { ...m, ...patch } : m)),
      }))
    },
    [mutate],
  )

  /**
   * Put a medic on a vehicle *from the playhead onwards*.
   *
   * Before their first posting there is nothing to preserve, so that edits the
   * base vehicle; after it, this records a swap and every leg that departs
   * before it keeps the vehicle it was quoted on.
   */
  const setVehicle = useCallback(
    (medicId: string, vehicle: VehicleType) => {
      // Floored, not rounded: a swap rounded *up* would sit a few minutes in the
      // future, and the picker would snap straight back to the old vehicle.
      const at = Math.floor(cursor / TIME_GRID_MS) * TIME_GRID_MS
      mutate(current => ({
        ...current,
        medics: current.medics.map(medic => {
          if (medic.id !== medicId) return medic
          const firstStation = [...medic.stations].sort(
            (a, b) => new Date(a.arriveAt).getTime() - new Date(b.arriveAt).getTime(),
          )[0]
          const firstMs = firstStation ? new Date(firstStation.arriveAt).getTime() : Infinity
          const changes = medic.vehicleChanges ?? []
          if (changes.length === 0 && at <= firstMs) {
            return { ...medic, vehicleType: vehicle }
          }
          const atIso = new Date(at).toISOString()
          // One swap per instant: picking twice at the same time replaces.
          const rest = changes.filter(c => new Date(c.at).getTime() !== at)
          const next = [
            ...rest,
            { id: `vc-${at.toString(36)}`, at: atIso, vehicleType: vehicle },
          ].sort((a, b) => a.at.localeCompare(b.at))
          return { ...medic, vehicleChanges: next }
        }),
      }))
    },
    [mutate, cursor],
  )

  const removeVehicleChange = useCallback(
    (medicId: string, changeId: string) => {
      mutate(current => ({
        ...current,
        medics: current.medics.map(medic => {
          if (medic.id !== medicId) return medic
          const next = (medic.vehicleChanges ?? []).filter(c => c.id !== changeId)
          return { ...medic, vehicleChanges: next.length > 0 ? next : undefined }
        }),
      }))
    },
    [mutate],
  )

  const toggleSweeper = useCallback(
    (medicId: string, disciplineId: string) => {
      mutate(current => ({
        ...current,
        medics: current.medics.map(medic => {
          if (medic.id !== medicId) return medic
          const now = planSweeps(medic)
          const next = now.some(s => s.disciplineId === disciplineId)
            ? now.filter(s => s.disciplineId !== disciplineId)
            : [
                ...now,
                {
                  disciplineId,
                  // A medic who already has postings almost always picks the
                  // tail up at one of them; only a unit with nothing on the
                  // board is a dedicated off-the-line sweeper.
                  joinFrom: medic.stations.length > 0 ? ('post' as const) : ('start' as const),
                },
              ]
          return { ...medic, sweeps: next.length > 0 ? next : undefined, sweeperFor: undefined }
        }),
      }))
    },
    [mutate],
  )

  const setSweepJoin = useCallback(
    (medicId: string, disciplineId: string, joinFrom: PlanSweepJoin) => {
      mutate(current => ({
        ...current,
        medics: current.medics.map(medic => {
          if (medic.id !== medicId) return medic
          const next = planSweeps(medic).map(s =>
            s.disciplineId === disciplineId ? { ...s, joinFrom } : s,
          )
          return { ...medic, sweeps: next, sweeperFor: undefined }
        }),
      }))
    },
    [mutate],
  )

  const addMedic = useCallback(() => {
    const id = `pm-local-${Date.now().toString(36)}`
    mutate(current => ({
      ...current,
      medics: [
        ...current.medics,
        {
          id,
          name: `Unit ${current.medics.length + 1}`,
          vehicleType: 'offroad-car' as VehicleType,
          color: planMedicColor(id),
          stations: [],
        },
      ],
    }))
    setSelectedMedicId(id)
    setTab('team')
  }, [mutate])

  const removeMedic = useCallback(
    (id: string) => {
      mutate(current => ({ ...current, medics: current.medics.filter(m => m.id !== id) }))
      setSelectedMedicId(current => (current === id ? null : current))
    },
    [mutate],
  )

  /**
   * Post a medic somewhere.
   *
   * A drag relocates the posting the medic is currently on — the coordinator is
   * saying "not there, here". A map click adds a NEW posting at the playhead,
   * which is how a shift gets built up hour by hour.
   */
  const placeStation = useCallback(
    (medicId: string, lngLat: [number, number], mode: 'drag' | 'click') => {
      const snap = snapTarget(lngLat)
      const coords = snap ? snap.coordinates : lngLat
      const label =
        snap?.name ||
        (snap ? POI_CONFIGS.find(c => c.type === snap.type)?.label ?? 'Point' : '')

      mutate(current => ({
        ...current,
        medics: current.medics.map(medic => {
          if (medic.id !== medicId) return medic
          const stations = [...medic.stations].sort(
            (a, b) => new Date(a.arriveAt).getTime() - new Date(b.arriveAt).getTime(),
          )

          // Which station is this gesture about?
          let targetId: string | null = null
          if (mode === 'drag') {
            const position = medicPositionAt(timelines[medic.id], cursor, sweepsFor(medic))
            // A sweep endpoint is derived from the discipline, not posted, so a
            // drag that lands on one is ignored rather than silently discarded
            // into a new posting somewhere else.
            targetId = position?.stationId.startsWith('sweep:') ? null : position?.stationId ?? null
            if (position?.phase === 'sweeping') return medic
          } else {
            const near = stations.find(
              s => Math.abs(new Date(s.arriveAt).getTime() - cursor) < TIME_GRID_MS / 2,
            )
            targetId = near?.id ?? null
          }

          if (targetId) {
            return {
              ...medic,
              stations: medic.stations.map(s =>
                s.id === targetId
                  ? {
                      ...s,
                      lng: coords[0],
                      lat: coords[1],
                      poiId: snap?.id,
                      label: label || s.label,
                      // The move into it has to be re-measured from scratch.
                      travelMinutes: s.travelSource === 'manual' ? s.travelMinutes : undefined,
                      travelSource: s.travelSource === 'manual' ? s.travelSource : undefined,
                    }
                  : s,
              ),
            }
          }

          const arriveAt = new Date(Math.round(cursor / TIME_GRID_MS) * TIME_GRID_MS).toISOString()
          const station: PlanStation = {
            id: `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            arriveAt,
            lng: coords[0],
            lat: coords[1],
            poiId: snap?.id,
            label: label || `Position ${stations.length + 1}`,
          }
          return { ...medic, stations: [...medic.stations, station] }
        }),
      }))
    },
    [mutate, snapTarget, cursor, timelines, sweepsFor],
  )

  const moveStation = useCallback(
    (medicId: string, stationId: string, arriveMs: number) => {
      mutate(current => ({
        ...current,
        medics: current.medics.map(medic =>
          medic.id === medicId
            ? {
                ...medic,
                stations: medic.stations.map(s =>
                  s.id === stationId ? { ...s, arriveAt: new Date(arriveMs).toISOString() } : s,
                ),
              }
            : medic,
        ),
      }))
    },
    [mutate],
  )

  /**
   * Bend a journey through a point.
   *
   * The waypoint is inserted where it costs least — try every slot in the
   * existing order and keep the cheapest — so grabbing the middle of a route
   * that already has two waypoints puts the new one between them rather than on
   * the end, which is what the hand expects.
   */
  /**
   * Bend a journey through a point, at the place in the order it was grabbed.
   *
   * `insertAt` comes from the piece of the drawn line that was taken hold of,
   * so pulling the stretch after via 1 makes the new point via 2. Choosing the
   * slot by cheapest insertion instead — which is what this did — is free to
   * reorder the waypoints and route the medic to the second one first, which is
   * not what anybody drew.
   */
  const addVia = useCallback(
    (medicId: string, stationId: string, lngLat: [number, number], insertAt: number) => {
      mutate(current => ({
        ...current,
        medics: current.medics.map(medic => {
          if (medic.id !== medicId) return medic
          return {
            ...medic,
            stations: medic.stations.map(s => {
              if (s.id !== stationId) return s
              const existing = s.via ?? []
              const slot = Math.max(0, Math.min(existing.length, insertAt))
              const via = [
                ...existing.slice(0, slot),
                { lat: lngLat[1], lng: lngLat[0] },
                ...existing.slice(slot),
              ]
              return {
                ...s,
                via,
                // The journey changed shape; its old duration is stale.
                travelMinutes: s.travelSource === 'manual' ? s.travelMinutes : undefined,
                travelSource: s.travelSource === 'manual' ? s.travelSource : undefined,
              }
            }),
          }
        }),
      }))
    },
    [mutate],
  )

  const moveVia = useCallback(
    (medicId: string, stationId: string, index: number, lngLat: [number, number]) => {
      mutate(current => ({
        ...current,
        medics: current.medics.map(medic =>
          medic.id === medicId
            ? {
                ...medic,
                stations: medic.stations.map(s =>
                  s.id === stationId
                    ? {
                        ...s,
                        via: (s.via ?? []).map((v, i) =>
                          i === index ? { lat: lngLat[1], lng: lngLat[0] } : v,
                        ),
                        travelMinutes: s.travelSource === 'manual' ? s.travelMinutes : undefined,
                        travelSource: s.travelSource === 'manual' ? s.travelSource : undefined,
                      }
                    : s,
                ),
              }
            : medic,
        ),
      }))
    },
    [mutate],
  )

  const removeVia = useCallback(
    (medicId: string, stationId: string, index: number) => {
      mutate(current => ({
        ...current,
        medics: current.medics.map(medic =>
          medic.id === medicId
            ? {
                ...medic,
                stations: medic.stations.map(s => {
                  if (s.id !== stationId) return s
                  const via = (s.via ?? []).filter((_, i) => i !== index)
                  return {
                    ...s,
                    via: via.length > 0 ? via : undefined,
                    travelMinutes: s.travelSource === 'manual' ? s.travelMinutes : undefined,
                    travelSource: s.travelSource === 'manual' ? s.travelSource : undefined,
                  }
                }),
              }
            : medic,
        ),
      }))
    },
    [mutate],
  )

  /** The medic's last block stops being open-ended; `null` reopens it. */
  const setStandDown = useCallback(
    (medicId: string, atMs: number | null) => {
      mutate(current => ({
        ...current,
        medics: current.medics.map(medic =>
          medic.id === medicId
            ? { ...medic, standDownAt: atMs == null ? undefined : new Date(atMs).toISOString() }
            : medic,
        ),
      }))
    },
    [mutate],
  )

  const patchStation = useCallback(
    (medicId: string, stationId: string, patch: Partial<PlanStation>) => {
      mutate(current => ({
        ...current,
        medics: current.medics.map(medic =>
          medic.id === medicId
            ? {
                ...medic,
                stations: medic.stations.map(s => (s.id === stationId ? { ...s, ...patch } : s)),
              }
            : medic,
        ),
      }))
    },
    [mutate],
  )

  const removeStation = useCallback(
    (medicId: string, stationId: string) => {
      mutate(current => ({
        ...current,
        medics: current.medics.map(medic =>
          medic.id === medicId
            ? { ...medic, stations: medic.stations.filter(s => s.id !== stationId) }
            : medic,
        ),
      }))
    },
    [mutate],
  )

  const focusStation = useCallback(
    (medicId: string, stationId: string) => {
      const station = medics.find(m => m.id === medicId)?.stations.find(s => s.id === stationId)
      if (!station) return
      const pad = 0.012
      setFitBounds([
        [station.lng - pad, station.lat - pad],
        [station.lng + pad, station.lat + pad],
      ])
      setCursorMs(new Date(station.arriveAt).getTime())
      setPlaying(false)
    },
    [medics],
  )

  const focusDiscipline = useCallback(
    (id: string) => {
      const discipline = disciplines.find(d => d.id === id)
      if (!discipline || discipline.course.coordinates.length === 0) return
      let minLng = Infinity
      let minLat = Infinity
      let maxLng = -Infinity
      let maxLat = -Infinity
      for (const [lng, lat] of discipline.course.coordinates) {
        if (lng < minLng) minLng = lng
        if (lat < minLat) minLat = lat
        if (lng > maxLng) maxLng = lng
        if (lat > maxLat) maxLat = lat
      }
      setFitBounds([
        [minLng, minLat],
        [maxLng, maxLat],
      ])
    },
    [disciplines],
  )

  const toggleDiscipline = useCallback((id: string) => {
    setHiddenDisciplineIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Fit the whole course set as the GPX files land. Tracks arrive one at a
  // time, so the camera keeps widening until they have all reported in — then
  // it stops, and the view is the coordinator's to move.
  const fittedCount = useRef(0)
  useEffect(() => {
    const withCourse = disciplines.filter(d => d.hasCourse)
    if (withCourse.length === 0 || withCourse.length <= fittedCount.current) return
    fittedCount.current = withCourse.length
    let minLng = Infinity
    let minLat = Infinity
    let maxLng = -Infinity
    let maxLat = -Infinity
    for (const d of withCourse) {
      for (const [lng, lat] of d.course.coordinates) {
        if (lng < minLng) minLng = lng
        if (lat < minLat) minLat = lat
        if (lng > maxLng) maxLng = lng
        if (lat > maxLat) maxLat = lat
      }
    }
    setFitBounds([
      [minLng, minLat],
      [maxLng, maxLat],
    ])
  }, [disciplines])

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) planner.history.redo()
        else planner.history.undo()
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        setPlaying(p => !p)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        setPlaying(false)
        const step = (e.shiftKey ? 60_000 : 5 * 60_000) * (e.key === 'ArrowLeft' ? -1 : 1)
        setCursorMs(current =>
          Math.max(bounds.fromMs, Math.min(bounds.toMs, (current ?? bounds.fromMs) + step)),
        )
      } else if (e.key === 'Escape') {
        setSelectedMedicId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bounds.fromMs, bounds.toMs, planner.history])

  const selectedMedic = medics.find(m => m.id === selectedMedicId) ?? null
  const center: [number, number] = planner.event?.days?.[0]?.pois?.[0]
    ? [planner.event.days[0].pois[0].lng, planner.event.days[0].pois[0].lat]
    : MAP_CENTER

  if (planner.loading || !plan) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: '#040a14' }}>
        <div className="flex items-center gap-3 text-sm" style={{ color: '#64748b' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading the plan…
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#040a14' }}>
      <PlannerStyles />

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header
        className="flex items-center gap-3 px-5 h-[58px] flex-shrink-0 no-print"
        style={{ borderBottom: '1px solid rgba(148,163,184,0.1)', background: 'rgba(8,15,28,0.9)' }}
      >
        <Link
          href={`/events/${eventId}`}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors"
          style={{ color: '#94a3b8', background: 'rgba(255,255,255,0.04)' }}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Event
        </Link>
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color: '#38bdf8' }} />
          <span className="text-sm font-bold" style={{ color: '#e2e8f0' }}>Deployment Planner</span>
        </div>
        <span className="text-xs truncate max-w-[280px]" style={{ color: '#475569' }}>
          {planner.event?.title}
        </span>

        <div className="flex-1" />

        <SaveBadge state={planner.saveState} />

        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(148,163,184,0.12)' }}>
          <button
            onClick={planner.history.undo}
            disabled={!planner.history.canUndo}
            className="px-2 py-1.5 disabled:opacity-30"
            style={{ color: '#94a3b8' }}
            title="Undo (⌘Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={planner.history.redo}
            disabled={!planner.history.canRedo}
            className="px-2 py-1.5 disabled:opacity-30"
            style={{ color: '#94a3b8' }}
            title="Redo (⇧⌘Z)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(148,163,184,0.12)' }}>
          {(['streets', 'terrain', 'satellite'] as const).map(layer => (
            <button
              key={layer}
              onClick={() => setBaseLayer(layer)}
              className="px-2.5 py-1.5 text-[10px] font-bold capitalize transition-colors"
              style={{
                background: baseLayer === layer ? 'rgba(56,189,248,0.16)' : 'transparent',
                color: baseLayer === layer ? '#38bdf8' : '#64748b',
              }}
            >
              {layer}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowDensity(v => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold"
          style={{
            background: showDensity ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${showDensity ? 'rgba(251,191,36,0.3)' : 'rgba(148,163,184,0.12)'}`,
            color: showDensity ? '#fbbf24' : '#64748b',
          }}
          title="Heat the course where the field is bunched up"
        >
          <Layers className="w-3 h-3" /> Field
        </button>
        <button
          onClick={() => setShowCoverage(v => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold"
          style={{
            background: showCoverage ? 'rgba(248,113,113,0.12)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${showCoverage ? 'rgba(248,113,113,0.3)' : 'rgba(148,163,184,0.12)'}`,
            color: showCoverage ? '#f87171' : '#64748b',
          }}
          title="Mark stretches of occupied course with no medic in reach"
        >
          <ShieldAlert className="w-3 h-3" /> Gaps
        </button>
        <button
          onClick={() => setShowRunners(v => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold"
          style={{
            background: showRunners ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${showRunners ? 'rgba(52,211,153,0.3)' : 'rgba(148,163,184,0.12)'}`,
            color: showRunners ? '#34d399' : '#64748b',
          }}
          title="Draw individual participants"
        >
          <Users className="w-3 h-3" /> Runners
        </button>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <aside
          className="w-[368px] flex-shrink-0 flex flex-col overflow-hidden no-print"
          style={{ borderRight: '1px solid rgba(148,163,184,0.08)', background: 'rgba(8,15,28,0.96)' }}
        >
          <div className="flex flex-shrink-0" style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex-1 py-3 text-[11px] font-bold uppercase tracking-widest relative transition-colors"
                style={{ color: tab === t ? '#e2e8f0' : '#475569' }}
              >
                {TAB_LABEL[t]}
                {tab === t && (
                  <span
                    className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full"
                    style={{ background: '#38bdf8' }}
                  />
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto planner-scroll">
            {tab === 'course' && (
              <CoursePanel
                disciplines={disciplines}
                fields={fields}
                cursorMs={cursor}
                onChange={patchSchedule}
                onFocus={focusDiscipline}
                hiddenDisciplineIds={hiddenDisciplineIds}
                onToggleVisible={toggleDiscipline}
                coverage={coverage}
                reachMinutes={reachMinutes}
                onReachMinutes={setReachMinutes}
                showCoverage={showCoverage}
                onToggleCoverage={() => setShowCoverage(v => !v)}
              />
            )}
            {tab === 'team' && (
              <TeamPanel
                medics={medics}
                timelines={timelines}
                selectedMedicId={selectedMedicId}
                onSelectMedic={setSelectedMedicId}
                cursorMs={cursor}
                onAddMedic={addMedic}
                onPatchMedic={patchMedic}
                onRemoveMedic={removeMedic}
                onPatchStation={patchStation}
                onRemoveStation={removeStation}
                onFocusStation={focusStation}
                onSetVehicle={setVehicle}
                onRemoveVehicleChange={removeVehicleChange}
                disciplines={disciplines.map(d => ({
                  id: d.id,
                  name: d.name,
                  color: d.color,
                  hasCourse: d.hasCourse,
                }))}
                onToggleSweeper={toggleSweeper}
                onSetSweepJoin={setSweepJoin}
                sweepsFor={sweepsFor}
                sweepWarningsFor={sweepWarningsFor}
              />
            )}
            {tab === 'briefing' && (
              <BriefingPanel
                medics={medics}
                eventTitle={planner.event?.title ?? 'Event'}
                resolveOptionsFor={resolveOptionsFor}
              />
            )}
          </div>
        </aside>

        <main className="flex-1 flex flex-col overflow-hidden relative">
          <div className="flex-1 relative">
            <PlannerMap
              center={center}
              baseLayer={baseLayer}
              disciplines={disciplines}
              fields={fields}
              hiddenDisciplineIds={hiddenDisciplineIds}
              pois={planner.pois}
              medicViews={medicViews}
              selectedMedicId={selectedMedicId}
              onSelectMedic={id => {
                setSelectedMedicId(id)
                if (id) setTab('team')
              }}
              onPlaceStation={(medicId, lngLat) => placeStation(medicId, lngLat, 'click')}
              onDragStation={(medicId, lngLat) => placeStation(medicId, lngLat, 'drag')}
              onAddVia={addVia}
              onMoveVia={moveVia}
              onRemoveVia={removeVia}
              snapTarget={snapTarget}
              fitBounds={fitBounds}
              showRunners={showRunners}
              showDensity={showDensity}
              coverage={coverage}
              reachMinutes={reachMinutes}
              sweepColors={sweepColors}
            />

            {/* Placement hint */}
            {selectedMedic && (
              <div
                className="absolute left-1/2 -translate-x-1/2 top-4 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl no-print"
                style={{
                  background: 'rgba(2,8,18,0.92)',
                  border: `1px solid ${selectedMedic.color}55`,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                  backdropFilter: 'blur(12px)',
                  animation: 'plannerHintIn 300ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: selectedMedic.color, boxShadow: `0 0 10px ${selectedMedic.color}` }}
                />
                <span className="text-xs font-semibold" style={{ color: '#e2e8f0' }}>
                  Click the map to post <strong>{selectedMedic.name}</strong> at{' '}
                  <span style={{ color: selectedMedic.color }}>{formatTime(cursor)}</span>
                </span>
                <span className="text-[10px]" style={{ color: '#475569' }}>
                  drag the puck to move a posting · drag its route to send it another way
                </span>
                <button onClick={() => setSelectedMedicId(null)} className="p-0.5" style={{ color: '#475569' }}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <PlannerTimeline
            fromMs={bounds.fromMs}
            toMs={bounds.toMs}
            cursorMs={cursor}
            onCursor={setCursorMs}
            playing={playing}
            onPlaying={setPlaying}
            speed={speed}
            onSpeed={setSpeed}
            disciplines={disciplines}
            hiddenDisciplineIds={hiddenDisciplineIds}
            onToggleDiscipline={toggleDiscipline}
            medics={medics}
            timelines={timelines}
            selectedMedicId={selectedMedicId}
            onSelectMedic={id => {
              setSelectedMedicId(id)
              if (id) setTab('team')
            }}
            onMoveStation={moveStation}
            onStationClick={(medicId, stationId) => {
              setSelectedMedicId(medicId)
              setTab('team')
              focusStation(medicId, stationId)
            }}
            onSetStandDown={setStandDown}
            collapsed={timelineCollapsed}
            onToggleCollapsed={() => setTimelineCollapsed(v => !v)}
          />
        </main>
      </div>
    </div>
  )
}

function SaveBadge({ state }: { state: ReturnType<typeof usePlanner>['saveState'] }) {
  const map = {
    idle: { label: 'Up to date', color: '#475569', icon: <Check className="w-3 h-3" /> },
    dirty: { label: 'Unsaved', color: '#f59e0b', icon: <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#f59e0b' }} /> },
    saving: { label: 'Saving', color: '#38bdf8', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    saved: { label: 'Saved', color: '#34d399', icon: <Check className="w-3 h-3" /> },
    error: { label: 'Not saved', color: '#f87171', icon: <CloudOff className="w-3 h-3" /> },
  } as const
  const entry = map[state]
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: entry.color }}>
      {entry.icon} {entry.label}
    </span>
  )
}

/** Animations + print rules used across the planner. */
function PlannerStyles() {
  return (
    <style jsx global>{`
      @keyframes plannerSnapPulse {
        0% { transform: scale(0.82); opacity: 1; }
        100% { transform: scale(1.25); opacity: 0; }
      }
      @keyframes plannerMovePulse {
        0% { transform: scale(0.62); opacity: 0.85; }
        100% { transform: scale(1.2); opacity: 0; }
      }
      @keyframes plannerHintIn {
        from { opacity: 0; transform: translate(-50%, -8px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
      .planner-scroll::-webkit-scrollbar { width: 8px; height: 10px; }
      .planner-scroll::-webkit-scrollbar-thumb {
        background: rgba(148,163,184,0.2);
        border-radius: 6px;
      }
      .planner-scroll::-webkit-scrollbar-track { background: transparent; }
      @media print {
        .no-print { display: none !important; }
        body { background: #fff !important; }
        .planner-print { color: #000 !important; }
      }
    `}</style>
  )
}
