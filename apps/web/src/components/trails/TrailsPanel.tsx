'use client'

import { useMemo } from 'react'
import { Activity, Anchor, Battery, Clock, Gauge, History, Loader2, Route } from 'lucide-react'
import type { MedicTrail } from '@events/contracts'
import { trailColor } from '@events/contracts'
import { TRAIL_WINDOWS, type TrailSummary, type TrailWindow } from '@/api/trails'
import { formatDistance, formatDuration, formatSpeed } from '@/lib/trail-geometry'

interface Props {
  summaries: TrailSummary[]
  trails: MedicTrail[]
  selectedIds: string[]
  onToggle: (medicId: string) => void
  onSelectAll: () => void
  onClearAll: () => void
  window: TrailWindow
  onWindow: (next: TrailWindow) => void
  loading: boolean
  error: string | null
  /** Fly the map to a medic's trail. */
  onLocate: (medicId: string) => void
  focusMedicId: string | null
  replayOpen: boolean
  onToggleReplay: () => void
}

/**
 * The Replay tab. Picks the window, picks the medics, and reports what their
 * breadcrumbs add up to — the numbers a coordinator needs for a debrief
 * ("who covered the north loop, and for how long?") without reading the map.
 */
export default function TrailsPanel({
  summaries, trails, selectedIds, onToggle, onSelectAll, onClearAll,
  window: activeWindow, onWindow, loading, error, onLocate, focusMedicId, replayOpen, onToggleReplay,
}: Props) {
  const trailById = useMemo(() => new Map(trails.map((t) => [t.medicId, t])), [trails])

  // Spell out what "Event" actually covers — a coordinator opening a debrief
  // months later should not have to infer the dates from the timeline.
  const archiveSpan = useMemo(() => {
    const first = trails[0]
    if (!first || first.mode !== 'event') return null
    const fmt = (iso: string) =>
      new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    return `${fmt(first.from)} → ${fmt(first.to)}`
  }, [trails])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  const totals = useMemo(() => {
    return trails.reduce(
      (acc, trail) => ({
        distanceMeters: acc.distanceMeters + trail.stats.distanceMeters,
        movingMs: acc.movingMs + trail.stats.movingMs,
        stationaryMs: acc.stationaryMs + trail.stats.stationaryMs,
        dwells: acc.dwells + trail.dwells.length,
      }),
      { distanceMeters: 0, movingMs: 0, stationaryMs: 0, dwells: 0 },
    )
  }, [trails])

  return (
    <div className="p-4 space-y-4">
      {/* Window picker. The trailing "Event" option is the archive: the event's
          own days rather than a rolling lookback, so a finished race can be
          reviewed months later. It is given its own accent to make clear it is
          a different KIND of span, not just a longer one. */}
      <div>
        <div className="text-xs font-semibold mb-2 uppercase tracking-widest" style={{ color: '#64748b' }}>
          Look back
        </div>
        <div className="flex gap-1.5 rounded-xl p-1" style={{ background: 'rgba(148,163,184,0.08)' }}>
          {TRAIL_WINDOWS.map((option) => {
            const active = activeWindow === option
            const isArchive = option === 'event'
            return (
              <button
                key={String(option)}
                onClick={() => onWindow(option)}
                className={`py-1.5 rounded-lg text-xs font-bold tabular-nums transition-colors ${isArchive ? 'flex-[1.4]' : 'flex-1'}`}
                style={{
                  background: active ? (isArchive ? 'rgba(56,189,248,0.18)' : 'rgba(34,197,94,0.16)') : 'transparent',
                  color: active ? (isArchive ? '#7dd3fc' : '#4ade80') : '#64748b',
                }}
                title={isArchive ? "The whole event, however long ago it ran" : `Last ${option} hours`}
              >
                {isArchive ? 'Event' : `${option}h`}
              </button>
            )
          })}
        </div>
        {activeWindow === 'event' && archiveSpan && (
          <div className="mt-1.5 text-[10.5px] font-semibold" style={{ color: '#7dd3fc' }}>
            {archiveSpan}
          </div>
        )}
      </div>

      {error && (
        <div
          className="rounded-xl px-3 py-2.5 text-xs font-semibold"
          style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.25)' }}
        >
          {error}
        </div>
      )}

      {summaries.length === 0 && !error ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <History className="w-10 h-10" style={{ color: '#334155' }} />
          <div className="text-sm font-semibold text-slate-500">
            {activeWindow === 'event' ? 'No location history for this event' : 'No location history in this window'}
          </div>
          <div className="text-xs" style={{ color: '#475569' }}>
            History is recorded only while an event is active, inside its daily hours.
          </div>
        </div>
      ) : (
        <>
          {/* Aggregate for the current selection */}
          {trails.length > 0 && (
            <div
              className="grid grid-cols-3 gap-2 rounded-xl p-3"
              style={{ background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.1)' }}
            >
              <Stat icon={<Route className="w-3 h-3" />} label="Covered" value={formatDistance(totals.distanceMeters)} />
              <Stat icon={<Activity className="w-3 h-3" />} label="Moving" value={formatDuration(totals.movingMs)} />
              <Stat icon={<Anchor className="w-3 h-3" />} label="Stops" value={String(totals.dwells)} />
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2" style={{ color: '#64748b' }}>
              Medics · {selectedIds.length}/{summaries.length}
              {loading && <Loader2 className="w-3 h-3 animate-spin" />}
            </div>
            <div className="flex gap-2 text-[11px] font-bold">
              <button onClick={onSelectAll} className="hover:brightness-150" style={{ color: '#4ade80' }}>All</button>
              <span style={{ color: '#334155' }}>·</span>
              <button onClick={onClearAll} className="hover:brightness-150" style={{ color: '#64748b' }}>None</button>
            </div>
          </div>

          <div className="space-y-2">
            {summaries.map((summary) => (
              <MedicTrailRow
                key={summary.medicId}
                summary={summary}
                trail={trailById.get(summary.medicId)}
                selected={selected.has(summary.medicId)}
                dimmed={!!focusMedicId && focusMedicId !== summary.medicId}
                onToggle={() => onToggle(summary.medicId)}
                onLocate={() => onLocate(summary.medicId)}
              />
            ))}
          </div>

          <button
            onClick={onToggleReplay}
            disabled={trails.length === 0}
            className="w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-opacity disabled:opacity-35 flex items-center justify-center gap-2"
            style={{
              background: replayOpen ? 'rgba(148,163,184,0.12)' : 'rgba(34,197,94,0.16)',
              color: replayOpen ? '#94a3b8' : '#4ade80',
            }}
          >
            <Clock className="w-3.5 h-3.5" />
            {replayOpen ? 'Close replay' : 'Replay on the map'}
          </button>
        </>
      )}
    </div>
  )
}

function MedicTrailRow({ summary, trail, selected, dimmed, onToggle, onLocate }: {
  summary: TrailSummary
  trail?: MedicTrail
  selected: boolean
  dimmed: boolean
  onToggle: () => void
  onLocate: () => void
}) {
  const color = trailColor(summary.medicId)
  const batteryDrop =
    trail?.stats.batteryStart != null && trail.stats.batteryEnd != null
      ? Math.round((trail.stats.batteryStart - trail.stats.batteryEnd) * 100)
      : null

  return (
    <div
      className="rounded-xl overflow-hidden transition-opacity"
      style={{
        opacity: dimmed ? 0.45 : 1,
        background: selected ? 'rgba(148,163,184,0.09)' : 'rgba(148,163,184,0.04)',
        border: `1px solid ${selected ? hexToRgba(color, 0.4) : 'rgba(148,163,184,0.08)'}`,
      }}
    >
      <button onClick={onToggle} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left">
        <span
          className="flex-shrink-0 w-3.5 h-3.5 rounded-[5px] flex items-center justify-center"
          style={{
            background: selected ? color : 'transparent',
            border: `1.5px solid ${selected ? color : 'rgba(148,163,184,0.35)'}`,
          }}
        >
          {selected && (
            <svg viewBox="0 0 10 10" className="w-2 h-2" fill="none" stroke="#0a1220" strokeWidth="2.2">
              <path d="M1.5 5.2 L4 7.6 L8.5 2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-slate-200 truncate">{summary.name}</span>
          <span className="block text-[10.5px] tabular-nums" style={{ color: '#475569' }}>
            {summary.points.toLocaleString()} points · last {shortAgo(summary.lastAt)}
          </span>
        </span>
        <span
          onClick={(e) => { e.stopPropagation(); onLocate() }}
          className="flex-shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:brightness-150"
          style={{ background: 'rgba(148,163,184,0.1)', color: '#94a3b8' }}
          role="button"
        >
          Show
        </span>
      </button>

      {selected && trail && (
        <div
          className="grid grid-cols-4 gap-1 px-3 pb-2.5 pt-0.5"
          style={{ borderTop: '1px solid rgba(148,163,184,0.07)' }}
        >
          <Stat icon={<Route className="w-3 h-3" />} label="Dist" value={formatDistance(trail.stats.distanceMeters)} />
          <Stat icon={<Activity className="w-3 h-3" />} label="Moving" value={formatDuration(trail.stats.movingMs)} />
          <Stat icon={<Gauge className="w-3 h-3" />} label="Avg" value={formatSpeed(trail.stats.avgMovingSpeed)} />
          <Stat
            icon={<Battery className="w-3 h-3" />}
            label="Batt"
            value={batteryDrop == null ? '—' : `−${Math.max(0, batteryDrop)}%`}
          />
        </div>
      )}
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider" style={{ color: '#475569' }}>
        {icon}
        {label}
      </div>
      <div className="text-xs font-bold tabular-nums truncate text-slate-200 mt-0.5">{value}</div>
    </div>
  )
}

function shortAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  return `rgba(${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)},${alpha})`
}
