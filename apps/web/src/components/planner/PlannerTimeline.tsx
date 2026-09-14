'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  Maximize2,
  Pause,
  Play,
  SkipBack,
  Waves,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { VEHICLE_TYPE_META } from '@events/contracts'
import type { PlanMedic } from '@events/contracts'
import type { PlannerDiscipline } from '@/hooks/usePlanner'
import type { MedicTimeline } from '@/lib/planner/schedule'
import { formatDuration, formatTime } from '@/lib/planner/itinerary'
import { fieldLoadCurve } from '@/lib/planner/load'

const HOUR = 3600_000
const GUTTER = 172
const RULER_HEIGHT = 38
const DISCIPLINE_LANE = 34
const MEDIC_LANE = 36

export const PLAY_SPEEDS = [60, 300, 900, 3600] as const
export type PlaySpeed = (typeof PLAY_SPEEDS)[number]

const SPEED_LABEL: Record<PlaySpeed, string> = {
  60: '1 min/s',
  300: '5 min/s',
  900: '15 min/s',
  3600: '1 h/s',
}

interface Props {
  fromMs: number
  toMs: number
  cursorMs: number
  onCursor: (ms: number) => void
  playing: boolean
  onPlaying: (playing: boolean) => void
  speed: PlaySpeed
  onSpeed: (speed: PlaySpeed) => void
  disciplines: PlannerDiscipline[]
  hiddenDisciplineIds: Set<string>
  onToggleDiscipline: (id: string) => void
  medics: PlanMedic[]
  timelines: Record<string, MedicTimeline>
  selectedMedicId: string | null
  onSelectMedic: (id: string | null) => void
  /** A station block was dragged to a new arrival time. */
  onMoveStation: (medicId: string, stationId: string, arriveMs: number) => void
  onStationClick: (medicId: string, stationId: string) => void
  collapsed: boolean
  onToggleCollapsed: () => void
}

/** Tick spacing that keeps labels readable at the current zoom. */
function tickPlan(pxPerHour: number): { minorMs: number; labelMs: number } {
  if (pxPerHour >= 220) return { minorMs: HOUR / 4, labelMs: HOUR }
  if (pxPerHour >= 110) return { minorMs: HOUR / 2, labelMs: HOUR }
  if (pxPerHour >= 55) return { minorMs: HOUR, labelMs: 2 * HOUR }
  if (pxPerHour >= 26) return { minorMs: HOUR, labelMs: 4 * HOUR }
  if (pxPerHour >= 12) return { minorMs: 2 * HOUR, labelMs: 6 * HOUR }
  return { minorMs: 6 * HOUR, labelMs: 12 * HOUR }
}

/** Local midnights inside the span — a 50-hour ultra needs day breaks to read. */
function midnightsBetween(fromMs: number, toMs: number): number[] {
  const out: number[] = []
  const cursor = new Date(fromMs)
  cursor.setHours(0, 0, 0, 0)
  cursor.setDate(cursor.getDate() + 1)
  while (cursor.getTime() < toMs) {
    out.push(cursor.getTime())
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

const DAY_FMT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export default function PlannerTimeline({
  fromMs,
  toMs,
  cursorMs,
  onCursor,
  playing,
  onPlaying,
  speed,
  onSpeed,
  disciplines,
  hiddenDisciplineIds,
  onToggleDiscipline,
  medics,
  timelines,
  selectedMedicId,
  onSelectMedic,
  onMoveStation,
  onStationClick,
  collapsed,
  onToggleCollapsed,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pxPerHour, setPxPerHour] = useState(60)
  const spanMs = Math.max(HOUR, toMs - fromMs)

  // ── Zoom ──────────────────────────────────────────────────────────────────
  const fit = useCallback(() => {
    const width = (scrollRef.current?.clientWidth ?? 1000) - GUTTER - 24
    setPxPerHour(Math.max(2, (width / spanMs) * HOUR))
  }, [spanMs])

  // The timeline fits itself to the window until the user takes over the zoom.
  // Without this a resized window leaves the lanes stranded in a column down
  // the left, with dead space where the clicks go nowhere.
  const userZoomed = useRef(false)
  useEffect(() => {
    if (userZoomed.current || spanMs <= HOUR) return
    fit()
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (!userZoomed.current) fit()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [fit, spanMs])

  const contentWidth = (spanMs / HOUR) * pxPerHour
  const xOf = useCallback((ms: number) => ((ms - fromMs) / HOUR) * pxPerHour, [fromMs, pxPerHour])
  const msOf = useCallback((x: number) => fromMs + (x / pxPerHour) * HOUR, [fromMs, pxPerHour])

  /** Zoom around the pointer so the hour under the cursor stays put. */
  const zoomAt = useCallback(
    (factor: number, clientX?: number) => {
      const el = scrollRef.current
      if (!el) return
      userZoomed.current = true
      const rect = el.getBoundingClientRect()
      const anchorX = (clientX ?? rect.left + rect.width / 2) - rect.left - GUTTER + el.scrollLeft
      const anchorMs = msOf(Math.max(0, anchorX))
      setPxPerHour(prev => {
        const next = Math.max(1.5, Math.min(900, prev * factor))
        requestAnimationFrame(() => {
          const nextX = ((anchorMs - fromMs) / HOUR) * next
          el.scrollLeft = Math.max(0, nextX - (rect.width - GUTTER) / 2)
        })
        return next
      })
    },
    [fromMs, msOf],
  )

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // ── Scrubbing ─────────────────────────────────────────────────────────────
  const laneAreaRef = useRef<HTMLDivElement>(null)
  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = laneAreaRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = clientX - rect.left
      onCursor(Math.max(fromMs, Math.min(toMs, msOf(x))))
    },
    [msOf, onCursor, fromMs, toMs],
  )

  const startScrub = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      onPlaying(false)
      seekFromClientX(e.clientX)
      const move = (ev: PointerEvent) => seekFromClientX(ev.clientX)
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [seekFromClientX, onPlaying],
  )

  // Keep the playhead on screen while playing.
  useEffect(() => {
    if (!playing) return
    const el = scrollRef.current
    if (!el) return
    const x = xOf(cursorMs)
    const viewLeft = el.scrollLeft
    const viewRight = viewLeft + el.clientWidth - GUTTER
    if (x < viewLeft + 40 || x > viewRight - 120) {
      el.scrollLeft = Math.max(0, x - (el.clientWidth - GUTTER) * 0.35)
    }
  }, [cursorMs, playing, xOf])

  // ── Station dragging ──────────────────────────────────────────────────────
  const [dragging, setDragging] = useState<{ medicId: string; stationId: string; previewMs: number } | null>(null)
  /** A drag ends in a click event; this keeps that click from also re-seeking. */
  const suppressClick = useRef(false)

  const startStationDrag = useCallback(
    (e: React.PointerEvent, medicId: string, stationId: string, arriveMs: number) => {
      e.preventDefault()
      e.stopPropagation()
      onPlaying(false)
      onSelectMedic(medicId)
      const startX = e.clientX
      let latest = arriveMs

      const move = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - startX) > 2) suppressClick.current = true
        const deltaMs = ((ev.clientX - startX) / pxPerHour) * HOUR
        // Five-minute grid by default; hold Shift for the minute.
        const grid = ev.shiftKey ? 60_000 : 5 * 60_000
        latest = Math.round((arriveMs + deltaMs) / grid) * grid
        setDragging({ medicId, stationId, previewMs: latest })
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setDragging(null)
        if (latest !== arriveMs) onMoveStation(medicId, stationId, latest)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [pxPerHour, onMoveStation, onPlaying, onSelectMedic],
  )

  // ── Derived rendering data ────────────────────────────────────────────────
  const ticks = useMemo(() => {
    const { minorMs, labelMs } = tickPlan(pxPerHour)
    const out: Array<{ ms: number; label?: string }> = []
    const first = Math.ceil(fromMs / minorMs) * minorMs
    for (let t = first; t <= toMs; t += minorMs) {
      out.push({ ms: t, label: t % labelMs === 0 ? formatTime(t) : undefined })
    }
    return out
  }, [fromMs, toMs, pxPerHour])

  const dayBreaks = useMemo(() => midnightsBetween(fromMs, toMs), [fromMs, toMs])

  const loadCurves = useMemo(() => {
    const out: Record<string, string> = {}
    for (const d of disciplines) {
      out[d.id] = fieldLoadCurve(d.schedule, d.shape, d.color)
    }
    return out
  }, [disciplines])

  const visibleMedics = medics.filter(m => !m.hidden)
  const nowMs = Date.now()

  const bodyHeight =
    disciplines.length * DISCIPLINE_LANE + visibleMedics.length * MEDIC_LANE + 16

  return (
    <div
      className="flex flex-col flex-shrink-0 select-none"
      style={{
        borderTop: '1px solid rgba(148,163,184,0.12)',
        background: 'linear-gradient(180deg, rgba(8,15,28,0.97) 0%, rgba(4,10,20,0.99) 100%)',
        height: collapsed ? 52 : Math.min(392, RULER_HEIGHT + bodyHeight + 52),
        transition: 'height 280ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {/* ── Transport ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 h-[52px] flex-shrink-0">
        <button
          onClick={() => {
            if (!playing && cursorMs >= toMs - 1000) onCursor(fromMs)
            onPlaying(!playing)
          }}
          className="flex items-center justify-center rounded-full transition-transform active:scale-90"
          style={{
            width: 34,
            height: 34,
            background: playing
              ? 'rgba(248,113,113,0.14)'
              : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            border: playing ? '1px solid rgba(248,113,113,0.4)' : 'none',
            color: playing ? '#f87171' : '#fff',
            boxShadow: playing ? 'none' : '0 4px 14px rgba(34,197,94,0.3)',
          }}
          title={playing ? 'Pause (space)' : 'Play (space)'}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <button
          onClick={() => { onPlaying(false); onCursor(fromMs) }}
          className="p-1.5 rounded-lg"
          style={{ color: '#64748b' }}
          title="Back to start"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <div
          className="px-3 py-1.5 rounded-xl font-mono tabular-nums"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.12)' }}
        >
          <span className="text-[10px] uppercase tracking-wider mr-2" style={{ color: '#64748b' }}>
            {DAY_FMT.format(new Date(cursorMs))}
          </span>
          <span className="text-sm font-bold" style={{ color: '#e2e8f0' }}>{formatTime(cursorMs)}</span>
        </div>

        <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid rgba(148,163,184,0.12)' }}>
          {PLAY_SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => onSpeed(s)}
              className="px-2.5 py-1.5 text-[10px] font-bold transition-colors"
              style={{
                background: speed === s ? 'rgba(56,189,248,0.16)' : 'transparent',
                color: speed === s ? '#38bdf8' : '#64748b',
              }}
            >
              {SPEED_LABEL[s]}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button onClick={() => zoomAt(1 / 1.4)} className="p-1.5 rounded-lg" style={{ color: '#64748b' }} title="Zoom out">
          <ZoomOut className="w-4 h-4" />
        </button>
        <button onClick={() => zoomAt(1.4)} className="p-1.5 rounded-lg" style={{ color: '#64748b' }} title="Zoom in">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => { userZoomed.current = false; fit() }}
          className="p-1.5 rounded-lg"
          style={{ color: '#64748b' }}
          title="Fit whole event"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          onClick={onToggleCollapsed}
          className="p-1.5 rounded-lg transition-transform"
          style={{ color: '#64748b', transform: collapsed ? 'rotate(180deg)' : 'none' }}
          title={collapsed ? 'Show timeline' : 'Hide timeline'}
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {/* ── Lanes ─────────────────────────────────────────────────────────── */}
      {!collapsed && (
        <div ref={scrollRef} className="flex-1 overflow-auto planner-scroll" style={{ position: 'relative' }}>
          <div style={{ width: GUTTER + contentWidth, position: 'relative' }}>
            {/* Ruler */}
            <div
              className="sticky top-0 z-20 flex"
              style={{ height: RULER_HEIGHT, background: 'rgba(4,10,20,0.97)', borderBottom: '1px solid rgba(148,163,184,0.1)' }}
            >
              <div
                className="sticky left-0 z-10 flex items-end pb-1.5 px-3 text-[9px] font-bold uppercase tracking-widest"
                style={{ width: GUTTER, background: 'rgba(4,10,20,0.97)', color: '#475569', borderRight: '1px solid rgba(148,163,184,0.08)' }}
              >
                Timeline
              </div>
              <div className="relative flex-1 cursor-ew-resize" onPointerDown={startScrub}>
                {ticks.map(tick => (
                  <div key={tick.ms} className="absolute bottom-0" style={{ left: xOf(tick.ms) }}>
                    <div
                      style={{
                        width: 1,
                        height: tick.label ? 12 : 6,
                        background: tick.label ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.15)',
                      }}
                    />
                    {tick.label && (
                      <span
                        className="absolute text-[9px] font-semibold tabular-nums whitespace-nowrap"
                        style={{ bottom: 14, left: 3, color: '#64748b' }}
                      >
                        {tick.label}
                      </span>
                    )}
                  </div>
                ))}
                {dayBreaks.map(ms => (
                  <div key={ms} className="absolute top-0 bottom-0" style={{ left: xOf(ms) }}>
                    <div className="absolute top-0 bottom-0" style={{ width: 1, background: 'rgba(56,189,248,0.3)' }} />
                    <span
                      className="absolute top-1 left-1.5 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider whitespace-nowrap"
                      style={{ background: 'rgba(56,189,248,0.12)', color: '#38bdf8' }}
                    >
                      {DAY_FMT.format(new Date(ms))}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Lane body */}
            <div className="flex" style={{ position: 'relative' }}>
              <div
                className="sticky left-0 z-10 flex-shrink-0"
                style={{ width: GUTTER, background: 'rgba(6,12,24,0.97)', borderRight: '1px solid rgba(148,163,184,0.08)' }}
              >
                {disciplines.map(d => (
                  <button
                    key={d.id}
                    onClick={() => onToggleDiscipline(d.id)}
                    className="w-full flex items-center gap-2 px-3 text-left"
                    style={{ height: DISCIPLINE_LANE, opacity: hiddenDisciplineIds.has(d.id) ? 0.4 : 1 }}
                    title={hiddenDisciplineIds.has(d.id) ? 'Show on map' : 'Hide from map'}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
                    <span className="text-[11px] font-semibold truncate" style={{ color: '#cbd5e1' }}>{d.name}</span>
                  </button>
                ))}
                {visibleMedics.map(m => {
                  const selected = m.id === selectedMedicId
                  return (
                    <button
                      key={m.id}
                      onClick={() => onSelectMedic(selected ? null : m.id)}
                      className="w-full flex items-center gap-2 px-3 text-left transition-colors"
                      style={{
                        height: MEDIC_LANE,
                        background: selected ? `${m.color}14` : 'transparent',
                        borderLeft: `2px solid ${selected ? m.color : 'transparent'}`,
                      }}
                    >
                      <span className="text-[13px] flex-shrink-0">
                        {(VEHICLE_TYPE_META[m.vehicleType] ?? VEHICLE_TYPE_META.foot).icon}
                      </span>
                      <span
                        className="text-[11px] font-semibold truncate"
                        style={{ color: selected ? '#e2e8f0' : '#94a3b8' }}
                      >
                        {m.name}
                      </span>
                      {(timelines[m.id]?.conflicts.length ?? 0) > 0 && (
                        <AlertTriangle className="w-3 h-3 flex-shrink-0 ml-auto" style={{ color: '#f87171' }} />
                      )}
                    </button>
                  )
                })}
              </div>

              <div ref={laneAreaRef} className="relative flex-1">
                {/* Day shading behind everything */}
                {dayBreaks.map(ms => (
                  <div
                    key={`break-${ms}`}
                    className="absolute top-0 bottom-0"
                    style={{ left: xOf(ms), width: 1, background: 'rgba(56,189,248,0.16)' }}
                  />
                ))}

                {/* Discipline lanes */}
                {disciplines.map((d, i) => {
                  const startMs = new Date(d.schedule.startAt).getTime()
                  const fastestMs = startMs + d.schedule.fastestMinutes * 60000
                  const endMs =
                    startMs + (d.schedule.slowestMinutes + (d.schedule.startWindowMinutes ?? 0)) * 60000
                  const left = xOf(startMs)
                  const width = Math.max(2, xOf(endMs) - left)
                  return (
                    <div key={d.id} className="absolute" style={{ top: i * DISCIPLINE_LANE, height: DISCIPLINE_LANE, left: 0, right: 0 }}>
                      <div
                        className="absolute rounded-md overflow-hidden"
                        style={{
                          left,
                          width,
                          top: 7,
                          height: DISCIPLINE_LANE - 14,
                          background: loadCurves[d.id],
                          border: `1px solid ${d.color}55`,
                          opacity: hiddenDisciplineIds.has(d.id) ? 0.3 : 1,
                        }}
                        title={`${d.name}: start ${formatTime(startMs)}, winner ${formatTime(fastestMs)}, cut-off ${formatTime(endMs)}`}
                      />
                      {/* Winner tick — the moment the field starts thinning. */}
                      <div
                        className="absolute"
                        style={{
                          left: xOf(fastestMs),
                          top: 5,
                          width: 1.5,
                          height: DISCIPLINE_LANE - 10,
                          background: '#fff7ed',
                          opacity: 0.7,
                        }}
                        title={`First finisher ${formatTime(fastestMs)}`}
                      />
                    </div>
                  )
                })}

                {/* Medic lanes */}
                {visibleMedics.map((medic, i) => {
                  const top = disciplines.length * DISCIPLINE_LANE + i * MEDIC_LANE
                  const timeline = timelines[medic.id]
                  const selected = medic.id === selectedMedicId
                  return (
                    <div
                      key={medic.id}
                      className="absolute"
                      style={{
                        top,
                        height: MEDIC_LANE,
                        left: 0,
                        right: 0,
                        background: selected ? `${medic.color}0d` : 'transparent',
                      }}
                    >
                      {(timeline?.segments ?? []).map((segment, si) => {
                        const segEnd = Number.isFinite(segment.toMs) ? segment.toMs : toMs
                        const left = xOf(segment.fromMs)
                        const width = Math.max(2, xOf(segEnd) - left)
                        if (segEnd < fromMs || segment.fromMs > toMs) return null

                        if (segment.kind === 'sweep') {
                          // Not a post and not a drive: the medic is on the
                          // course, moving with the back of the field. Drawn as
                          // a solid band in that discipline's colour so the lane
                          // reads against the discipline lane above it.
                          const color = segment.color ?? medic.color
                          return (
                            <div
                              key={`${segment.stationId}-sweep-${si}`}
                              onClick={e => { e.stopPropagation(); onStationClick(medic.id, segment.stationId) }}
                              className="absolute flex items-center gap-1 px-2 rounded-lg overflow-hidden"
                              style={{
                                left,
                                width,
                                top: 5,
                                height: MEDIC_LANE - 10,
                                background: `linear-gradient(90deg, ${color}44, ${color}22)`,
                                border: `1px solid ${color}`,
                                cursor: 'pointer',
                              }}
                              title={`Sweeping ${segment.label} — with the last participant, ${formatTime(segment.fromMs)} to ${formatTime(segEnd)}`}
                            >
                              <Waves className="w-2.5 h-2.5 flex-shrink-0" style={{ color }} />
                              {width > 60 && (
                                <span className="text-[9px] font-bold truncate" style={{ color: '#e2e8f0' }}>
                                  Sweeping {segment.label}
                                </span>
                              )}
                            </div>
                          )
                        }

                        if (segment.kind === 'move') {
                          return (
                            <div
                              key={`${segment.stationId}-move-${si}`}
                              className="absolute flex items-center justify-center"
                              style={{
                                left,
                                width,
                                top: MEDIC_LANE / 2 - 5,
                                height: 10,
                                borderRadius: 5,
                                background: segment.tight
                                  ? 'repeating-linear-gradient(45deg, rgba(248,113,113,0.6) 0 4px, rgba(248,113,113,0.2) 4px 8px)'
                                  : `repeating-linear-gradient(45deg, ${medic.color}cc 0 4px, ${medic.color}44 4px 8px)`,
                                border: segment.tight ? '1px solid #f87171' : `1px solid ${medic.color}66`,
                              }}
                              title={
                                segment.tight
                                  ? `Too tight: ${segment.label} needs ${formatDuration(segment.shortfallMinutes ?? 0)} more`
                                  : `Travel to ${segment.label} on ${
                                      VEHICLE_TYPE_META[segment.vehicleType ?? medic.vehicleType]?.label ?? 'foot'
                                    } — ${formatDuration((segEnd - segment.fromMs) / 60000)}${segment.travelSource === 'routed' ? ' (routed)' : ''}`
                              }
                            >
                              {segment.tight && width > 16 && (
                                <AlertTriangle className="w-2.5 h-2.5" style={{ color: '#fff' }} />
                              )}
                            </div>
                          )
                        }

                        const isDragging = dragging?.stationId === segment.stationId
                        const dragOffset = isDragging ? xOf(dragging!.previewMs) - xOf(segment.fromMs) : 0
                        return (
                          <div
                            key={`${segment.stationId}-hold-${si}`}
                            onPointerDown={e => startStationDrag(e, medic.id, segment.stationId, segment.fromMs)}
                            onClick={e => {
                              e.stopPropagation()
                              if (suppressClick.current) {
                                suppressClick.current = false
                                return
                              }
                              onStationClick(medic.id, segment.stationId)
                            }}
                            className="absolute flex items-center gap-1 px-2 rounded-lg overflow-hidden"
                            style={{
                              left: left + dragOffset,
                              width,
                              top: 6,
                              height: MEDIC_LANE - 12,
                              background: `${medic.color}22`,
                              border: `1px solid ${medic.color}${isDragging ? 'ff' : '77'}`,
                              boxShadow: isDragging ? `0 0 0 3px ${medic.color}33` : 'none',
                              cursor: 'ew-resize',
                              zIndex: isDragging ? 5 : 1,
                            }}
                            title={`${segment.label} — from ${formatTime(segment.fromMs)}`}
                          >
                            <span
                              className="w-1 h-1 rounded-full flex-shrink-0"
                              style={{ background: medic.color }}
                            />
                            {width > 44 && (
                              <span
                                className="text-[9px] font-bold truncate"
                                style={{ color: '#e2e8f0' }}
                              >
                                {isDragging ? formatTime(dragging!.previewMs) : segment.label}
                              </span>
                            )}
                          </div>
                        )
                      })}
                      {/* Vehicle swaps, pinned to the lane. A swap changes what
                          every later leg costs, so it belongs on the clock. */}
                      {(medic.vehicleChanges ?? []).map(change => {
                        const at = new Date(change.at).getTime()
                        if (!Number.isFinite(at) || at < fromMs || at > toMs) return null
                        return (
                          <div
                            key={change.id}
                            className="absolute flex items-center justify-center rounded-full pointer-events-none"
                            style={{
                              left: xOf(at) - 8,
                              top: MEDIC_LANE / 2 - 8,
                              width: 16,
                              height: 16,
                              fontSize: 8,
                              background: 'rgba(2,8,18,0.95)',
                              border: `1px solid ${medic.color}`,
                              zIndex: 4,
                            }}
                            title={`Switches to ${VEHICLE_TYPE_META[change.vehicleType]?.label ?? 'foot'} at ${formatTime(at)}`}
                          >
                            {VEHICLE_TYPE_META[change.vehicleType]?.icon ?? '🚶'}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}

                <div style={{ height: bodyHeight }} />

                {/* Now line */}
                {nowMs > fromMs && nowMs < toMs && (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none"
                    style={{ left: xOf(nowMs), width: 1, background: 'rgba(34,197,94,0.5)' }}
                  />
                )}

                {/* Playhead */}
                <div
                  className="absolute top-0 bottom-0 pointer-events-none z-30"
                  style={{ left: xOf(cursorMs), width: 2, background: '#38bdf8', boxShadow: '0 0 12px rgba(56,189,248,0.8)' }}
                >
                  <div
                    className="absolute rounded-full"
                    style={{ top: -4, left: -4, width: 10, height: 10, background: '#38bdf8' }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
