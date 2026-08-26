'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Pause, Play, Radio, SkipBack, X } from 'lucide-react'
import type { MedicTrail } from '@events/contracts'
import { trailColor } from '@events/contracts'
import { formatClock } from '@/lib/trail-geometry'

/** Timeline geometry. The lanes are laid out from these rather than from a
 *  fixed track height, so a six-medic event doesn't overflow its own track and
 *  push the coverage bars over the hour labels. */
const LANE_HEIGHT = 3
const LANE_GAP = 3
const LABEL_ROW = 14

function lanesHeight(count: number): number {
  return Math.max(6, count * LANE_HEIGHT + Math.max(0, count - 1) * LANE_GAP)
}

/** Playback rates. 60× walks a 12h window past in twelve minutes; 720× in one. */
export const REPLAY_SPEEDS = [30, 120, 360, 720] as const
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number]

interface Props {
  fromMs: number
  toMs: number
  /** Null = live: trails are drawn whole and the cursor is parked at the end. */
  cursorMs: number | null
  onCursor: (ms: number | null) => void
  playing: boolean
  onPlaying: (playing: boolean) => void
  speed: ReplaySpeed
  onSpeed: (speed: ReplaySpeed) => void
  /** Drawn as coverage lanes, so gaps in someone's tracking are visible. */
  trails: MedicTrail[]
  onClose: () => void
}

/**
 * The replay transport: a timeline across the bottom of the map with one lane
 * per medic showing exactly when that medic was reporting. The lanes are the
 * point — a flat "12 hours" bar hides the thing a coordinator most needs to
 * know after an incident, which is who had coverage and who had gone dark.
 */
export default function TimeScrubber({
  fromMs, toMs, cursorMs, onCursor, playing, onPlaying, speed, onSpeed, trails, onClose,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const spanMs = Math.max(1, toMs - fromMs)
  const effectiveCursor = cursorMs ?? toMs
  const progress = clamp01((effectiveCursor - fromMs) / spanMs)

  // ── Playback ──────────────────────────────────────────────────────────────
  // Driven by rAF off the wall clock rather than a fixed tick, so the replay
  // runs at the same speed on a 60Hz and a 120Hz display and doesn't drift when
  // the tab is throttled.
  const cursorRef = useRef(effectiveCursor)
  cursorRef.current = effectiveCursor

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let previous = performance.now()

    const step = (now: number) => {
      const deltaMs = (now - previous) * speed
      previous = now
      const next = cursorRef.current + deltaMs
      if (next >= toMs) {
        onCursor(toMs)
        onPlaying(false)
        return
      }
      onCursor(next)
      frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, toMs, onCursor, onPlaying])

  const togglePlay = useCallback(() => {
    if (playing) {
      onPlaying(false)
      return
    }
    // Pressing play at the end restarts rather than doing nothing.
    if (cursorMs == null || cursorMs >= toMs - 1000) onCursor(fromMs)
    onPlaying(true)
  }, [playing, cursorMs, toMs, fromMs, onCursor, onPlaying])

  // ── Scrubbing ─────────────────────────────────────────────────────────────
  const seekFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      onCursor(fromMs + clamp01((clientX - rect.left) / rect.width) * spanMs)
    },
    [fromMs, spanMs, onCursor],
  )

  const startScrub = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      onPlaying(false)
      seekFromPointer(e.clientX)

      const move = (ev: PointerEvent) => seekFromPointer(ev.clientX)
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [seekFromPointer, onPlaying],
  )

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never steal keys from a field the user is typing in.
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        onPlaying(false)
        // Fine step with shift (1 min), coarse without (5 min).
        const stepMs = (e.shiftKey ? 60_000 : 300_000) * (e.key === 'ArrowLeft' ? -1 : 1)
        onCursor(Math.min(toMs, Math.max(fromMs, effectiveCursor + stepMs)))
      } else if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, onCursor, onPlaying, effectiveCursor, fromMs, toMs, onClose])

  // ── Gridlines ─────────────────────────────────────────────────────────────
  // The tick spacing is chosen from a ladder rather than fixed at one hour: an
  // archived two-day event spans ~36h, and hourly ticks there would print three
  // dozen labels into a few hundred pixels. A multi-day span also gets the date
  // on the label, since "06:00" alone is ambiguous across days.
  const ticks = useMemo(() => {
    const H = 3_600_000
    const ladder = [H, 2 * H, 3 * H, 6 * H, 12 * H, 24 * H]
    const step = ladder.find((candidate) => spanMs / candidate <= 8) ?? 24 * H
    const multiDay = spanMs > 24 * H

    const marks: Array<{ left: number; label: string }> = []
    const first = Math.ceil(fromMs / step) * step
    for (let t = first; t <= toMs; t += step) {
      const d = new Date(t)
      const label = multiDay
        ? `${d.getDate()}/${d.getMonth() + 1} ${formatClock(t)}`
        : formatClock(t)
      marks.push({ left: ((t - fromMs) / spanMs) * 100, label })
    }
    return marks
  }, [fromMs, toMs, spanMs])

  const isLive = cursorMs == null
  const lanesPx = lanesHeight(trails.length)
  const trackPx = lanesPx + LABEL_ROW

  return (
    <div
      className="absolute bottom-0 left-0 right-0 px-3 pb-3 pt-2 sm:px-4"
      style={{ zIndex: 15, background: 'linear-gradient(to top, rgba(4,10,20,0.96), rgba(4,10,20,0))' }}
    >
      <div
        className="rounded-2xl px-3 py-2.5 sm:px-4"
        style={{
          background: 'rgba(10,18,34,0.94)',
          backdropFilter: 'blur(14px)',
          border: '1px solid rgba(148,163,184,0.16)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}
      >
        {/* Transport row */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={togglePlay}
            className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-105"
            style={{ background: '#22c55e', color: '#04121f' }}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            aria-label={playing ? 'Pause replay' : 'Play replay'}
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          <button
            onClick={() => { onPlaying(false); onCursor(fromMs) }}
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:brightness-150"
            style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8' }}
            title="Back to the start of the window"
            aria-label="Restart replay"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          {/* Big clock — the one number worth reading mid-replay. */}
          <div className="flex-shrink-0 tabular-nums leading-none">
            <div className="text-lg font-black" style={{ color: isLive ? '#22c55e' : '#e2e8f0' }}>
              {formatClock(effectiveCursor)}
            </div>
            <div className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: '#475569' }}>
              {/* Across a multi-day archive "3h ago" is meaningless — show the
                  actual date instead. */}
              {spanMs > 24 * 3_600_000
                ? new Date(effectiveCursor).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                : isLive
                  ? 'live'
                  : relativeLabel(effectiveCursor, toMs)}
            </div>
          </div>

          <div className="flex-1" />

          <div className="hidden sm:flex items-center gap-1 rounded-lg p-0.5" style={{ background: 'rgba(148,163,184,0.1)' }}>
            {REPLAY_SPEEDS.map((option) => (
              <button
                key={option}
                onClick={() => onSpeed(option)}
                className="px-2 py-1 rounded-md text-[11px] font-bold tabular-nums transition-colors"
                style={{
                  background: speed === option ? 'rgba(34,197,94,0.18)' : 'transparent',
                  color: speed === option ? '#4ade80' : '#64748b',
                }}
              >
                {option}×
              </button>
            ))}
          </div>

          <button
            onClick={() => { onPlaying(false); onCursor(null) }}
            disabled={isLive}
            className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-opacity disabled:opacity-35"
            style={{ background: 'rgba(34,197,94,0.14)', color: '#4ade80' }}
            title="Show the whole window and follow live"
          >
            <Radio className="w-3 h-3" /> Live
          </button>

          <button
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:brightness-150"
            style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8' }}
            title="Close replay (Esc)"
            aria-label="Close replay"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Timeline */}
        <div
          ref={trackRef}
          onPointerDown={startScrub}
          className="relative mt-2.5 cursor-pointer select-none touch-none"
          style={{ height: trackPx }}
          role="slider"
          aria-label="Replay time"
          aria-valuemin={fromMs}
          aria-valuemax={toMs}
          aria-valuenow={effectiveCursor}
          aria-valuetext={formatClock(effectiveCursor)}
          tabIndex={0}
        >
          {/* Hour gridlines. The label sits in its own reserved row below the
              lanes, never underneath them. */}
          {ticks.map((tick) => (
            <div key={tick.left} className="absolute top-0" style={{ left: `${tick.left}%`, height: trackPx }}>
              <div className="w-px" style={{ height: lanesPx, background: 'rgba(148,163,184,0.12)' }} />
              <div
                className="absolute bottom-0 -translate-x-1/2 text-[8.5px] font-bold tabular-nums leading-none"
                style={{ color: '#475569' }}
              >
                {tick.label}
              </div>
            </div>
          ))}

          {/* One coverage lane per medic */}
          <div
            className="absolute inset-x-0 top-0 flex flex-col"
            style={{ height: lanesPx, gap: LANE_GAP }}
          >
            {trails.map((trail) => (
              <CoverageLane key={trail.medicId} trail={trail} fromMs={fromMs} spanMs={spanMs} />
            ))}
          </div>

          {/* Everything after the cursor is dimmed — the replay hasn't got there. */}
          {!isLive && (
            <div
              className="absolute top-0 rounded-r"
              style={{ left: `${progress * 100}%`, right: 0, height: lanesPx, background: 'rgba(4,10,20,0.55)' }}
            />
          )}

          {/* Playhead */}
          <div
            className="absolute top-0 pointer-events-none"
            style={{ left: `${progress * 100}%`, height: lanesPx }}
          >
            <div className="w-0.5 h-full -translate-x-1/2" style={{ background: isLive ? '#22c55e' : '#e2e8f0' }} />
            <div
              className="absolute -top-1 -translate-x-1/2 w-2.5 h-2.5 rounded-full"
              style={{ background: isLive ? '#22c55e' : '#e2e8f0', boxShadow: '0 0 8px rgba(0,0,0,0.6)' }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * One medic's reporting coverage. Consecutive samples closer than the gap
 * threshold are merged into a single block, so the bar shows solid stretches
 * broken by the outages rather than 1200 hairlines.
 */
function CoverageLane({ trail, fromMs, spanMs }: { trail: MedicTrail; fromMs: number; spanMs: number }) {
  const blocks = useMemo(() => {
    const GAP_MS = 8 * 60_000
    const t = trail.samples.t
    const out: Array<{ left: number; width: number }> = []
    if (t.length === 0) return out

    let start = t[0]
    for (let i = 1; i <= t.length; i += 1) {
      const broken = i === t.length || t[i] - t[i - 1] > GAP_MS
      if (!broken) continue
      const end = t[i - 1]
      out.push({
        left: ((start - fromMs) / spanMs) * 100,
        // Floor the width so a single isolated fix is still a visible pip.
        width: Math.max(0.4, ((end - start) / spanMs) * 100),
      })
      if (i < t.length) start = t[i]
    }
    return out
  }, [trail, fromMs, spanMs])

  const color = trailColor(trail.medicId)
  return (
    <div
      className="relative rounded-full flex-shrink-0"
      style={{ height: LANE_HEIGHT, background: 'rgba(148,163,184,0.07)' }}
      title={trail.name}
    >
      {blocks.map((block, i) => (
        <div
          key={i}
          className="absolute top-0 h-full rounded-full"
          style={{ left: `${block.left}%`, width: `${block.width}%`, background: color, opacity: 0.85 }}
        />
      ))}
    </div>
  )
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function relativeLabel(cursorMs: number, toMs: number): string {
  const minutes = Math.round((toMs - cursorMs) / 60_000)
  if (minutes <= 0) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h ago` : `${hours}h ${rest}m ago`
}
