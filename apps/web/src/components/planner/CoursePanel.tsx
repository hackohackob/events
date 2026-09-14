'use client'

import { useMemo } from 'react'
import { Flag, Mountain, Route, ShieldAlert, ShieldCheck, TriangleAlert, Users } from 'lucide-react'
import type { PlanDisciplineSchedule } from '@events/contracts'
import type { PlannerDiscipline } from '@/hooks/usePlanner'
import type { FieldState } from '@/lib/planner/field'
import { formatDuration, formatStamp } from '@/lib/planner/itinerary'
import type { CoverageReport } from '@/lib/planner/coverage'

interface Props {
  disciplines: PlannerDiscipline[]
  fields: Record<string, FieldState>
  cursorMs: number
  onChange: (id: string, patch: Partial<PlanDisciplineSchedule>) => void
  onFocus: (id: string) => void
  hiddenDisciplineIds: Set<string>
  onToggleVisible: (id: string) => void
  coverage: Record<string, CoverageReport>
  /** How long a medic is given to get there. */
  reachMinutes: number
  onReachMinutes: (minutes: number) => void
  showCoverage: boolean
  onToggleCoverage: () => void
}

/** `Date` ⇄ the `datetime-local` string, which is always LOCAL wall time. */
function toLocalInput(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * Hours + minutes, because a cut-off is not a time of day. A 160 km race runs a
 * 50-hour limit, so the hours box is deliberately unbounded — anything that
 * rolls a duration into a clock breaks the moment an event passes midnight.
 */
function DurationField({
  label,
  minutes,
  onChange,
  accent,
}: {
  label: string
  minutes: number
  onChange: (minutes: number) => void
  accent: string
}) {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return (
    <label className="flex-1 min-w-0">
      <span className="block text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: '#64748b' }}>
        {label}
      </span>
      <span
        className="flex items-center rounded-lg overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.14)' }}
      >
        <input
          type="number"
          min={0}
          value={h}
          onChange={e => onChange(Math.max(0, Number(e.target.value) || 0) * 60 + m)}
          className="w-full min-w-0 bg-transparent px-2 py-1.5 text-sm font-bold tabular-nums outline-none"
          style={{ color: accent }}
        />
        <span className="text-[10px] font-bold pr-1" style={{ color: '#475569' }}>h</span>
        <input
          type="number"
          min={0}
          max={59}
          value={m}
          onChange={e => onChange(h * 60 + Math.min(59, Math.max(0, Number(e.target.value) || 0)))}
          className="w-full min-w-0 bg-transparent px-2 py-1.5 text-sm font-bold tabular-nums outline-none"
          style={{ color: accent }}
        />
        <span className="text-[10px] font-bold pr-2" style={{ color: '#475569' }}>m</span>
      </span>
    </label>
  )
}

export default function CoursePanel({
  disciplines,
  fields,
  cursorMs,
  onChange,
  onFocus,
  hiddenDisciplineIds,
  onToggleVisible,
  coverage,
  reachMinutes,
  onReachMinutes,
  showCoverage,
  onToggleCoverage,
}: Props) {
  const totals = useMemo(() => {
    let onCourse = 0
    let uncovered = 0
    let occupied = 0
    for (const d of disciplines) {
      if (hiddenDisciplineIds.has(d.id)) continue
      onCourse += fields[d.id]?.onCourse ?? 0
      uncovered += coverage[d.id]?.uncoveredMeters ?? 0
      occupied += coverage[d.id]?.occupiedMeters ?? 0
    }
    return { onCourse, uncovered, occupied }
  }, [disciplines, fields, hiddenDisciplineIds, coverage])

  // Whether any course's reach came off the router rather than a radius. Worth
  // saying out loud: the two answers can differ by kilometres in a valley.
  const routedSomewhere = useMemo(
    () => disciplines.some(d => coverage[d.id]?.routed),
    [disciplines, coverage],
  )

  if (disciplines.length === 0) {
    return (
      <div className="p-6 text-center">
        <Route className="w-8 h-8 mx-auto mb-3" style={{ color: '#334155' }} />
        <p className="text-sm font-semibold" style={{ color: '#94a3b8' }}>No disciplines yet</p>
        <p className="text-xs mt-1.5" style={{ color: '#64748b' }}>
          Add disciplines with their GPX tracks to the event, then come back here to time them.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <div
        className="flex items-center justify-between px-3 py-2.5 rounded-xl"
        style={{ background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.18)' }}
      >
        <div>
          <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>
            On course now
          </div>
          <div className="text-lg font-black tabular-nums" style={{ color: '#38bdf8' }}>
            {totals.onCourse}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>
            Simulated clock
          </div>
          <div className="text-xs font-bold tabular-nums" style={{ color: '#cbd5e1' }}>
            {formatStamp(cursorMs)}
          </div>
        </div>
      </div>

      {/* Reach — the number that decides whether a plan is finished. */}
      <div
        className="px-3 py-2.5 rounded-xl"
        style={{
          background: totals.uncovered > 0 ? 'rgba(248,113,113,0.07)' : 'rgba(52,211,153,0.06)',
          border: `1px solid ${totals.uncovered > 0 ? 'rgba(248,113,113,0.2)' : 'rgba(52,211,153,0.18)'}`,
        }}
      >
        <div className="flex items-center gap-2">
          {totals.uncovered > 0 ? (
            <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#f87171' }} />
          ) : (
            <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#34d399' }} />
          )}
          <span className="text-xs font-bold flex-1" style={{ color: totals.uncovered > 0 ? '#fca5a5' : '#6ee7b7' }}>
            {totals.occupied === 0
              ? 'Nobody on course'
              : totals.uncovered > 0
                ? `${(totals.uncovered / 1000).toFixed(1)} km out of reach`
                : 'Whole field in reach'}
          </span>
          <button
            onClick={onToggleCoverage}
            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ color: showCoverage ? '#94a3b8' : '#475569', background: 'rgba(255,255,255,0.05)' }}
          >
            {showCoverage ? 'on' : 'off'}
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#475569' }}>
            Reach
          </span>
          <input
            type="range"
            min={2}
            max={45}
            step={1}
            value={reachMinutes}
            onChange={e => onReachMinutes(Number(e.target.value))}
            className="flex-1 accent-sky-400"
            title="How long a medic is given to get there, driven on the road network"
          />
          <span className="text-[10px] font-bold tabular-nums w-10 text-right" style={{ color: '#94a3b8' }}>
            {reachMinutes}m
          </span>
        </div>
        {routedSomewhere ? (
          <div className="text-[9px] mt-1" style={{ color: '#475569' }}>
            Measured on the road network — a ridge in the way counts against it.
          </div>
        ) : (
          <div className="text-[9px] mt-1" style={{ color: '#f59e0b' }}>
            Straight-line estimate — the routing engine has not answered yet.
          </div>
        )}
      </div>

      {disciplines.map(d => {
        const field = fields[d.id]
        const hidden = hiddenDisciplineIds.has(d.id)
        const startMs = new Date(d.schedule.startAt).getTime()
        const cutoffMs = startMs + (d.schedule.slowestMinutes + (d.schedule.startWindowMinutes ?? 0)) * 60000
        return (
          <div
            key={d.id}
            className="rounded-2xl overflow-hidden transition-opacity"
            style={{
              background: 'rgba(255,255,255,0.025)',
              border: `1px solid ${hidden ? 'rgba(148,163,184,0.1)' : `${d.color}33`}`,
              opacity: hidden ? 0.55 : 1,
            }}
          >
            <div
              className="flex items-center gap-2 px-3 py-2.5"
              style={{ background: `linear-gradient(90deg, ${d.color}1f, transparent)` }}
            >
              <button
                onClick={() => onToggleVisible(d.id)}
                className="w-2.5 h-2.5 rounded-full flex-shrink-0 transition-transform active:scale-75"
                style={{ background: hidden ? 'transparent' : d.color, border: `1.5px solid ${d.color}` }}
                title={hidden ? 'Show on map' : 'Hide from map'}
              />
              <button onClick={() => onFocus(d.id)} className="flex-1 min-w-0 text-left">
                <div className="text-sm font-bold truncate" style={{ color: '#e2e8f0' }}>{d.name}</div>
                <div className="flex items-center gap-2.5 text-[10px] mt-0.5" style={{ color: '#64748b' }}>
                  <span className="flex items-center gap-1"><Route className="w-2.5 h-2.5" />{d.distanceKm} km</span>
                  <span className="flex items-center gap-1"><Mountain className="w-2.5 h-2.5" />{d.ascentMeters} m</span>
                  {!d.hasCourse && (
                    <span className="flex items-center gap-1" style={{ color: '#f59e0b' }}>
                      <TriangleAlert className="w-2.5 h-2.5" /> no GPX
                    </span>
                  )}
                </div>
              </button>
            </div>

            <div className="px-3 pb-3 pt-1 space-y-2.5">
              <label className="block">
                <span className="block text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: '#64748b' }}>
                  Start
                </span>
                <input
                  type="datetime-local"
                  value={toLocalInput(d.schedule.startAt)}
                  onChange={e => {
                    const at = new Date(e.target.value)
                    if (!Number.isNaN(at.getTime())) onChange(d.id, { startAt: at.toISOString() })
                  }}
                  className="w-full rounded-lg px-2 py-1.5 text-sm font-semibold outline-none"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(148,163,184,0.14)',
                    color: '#e2e8f0',
                    colorScheme: 'dark',
                  }}
                />
              </label>

              <div className="flex gap-2">
                <DurationField
                  label="Best finish"
                  minutes={d.schedule.fastestMinutes}
                  accent="#34d399"
                  onChange={minutes =>
                    onChange(d.id, {
                      fastestMinutes: Math.max(1, minutes),
                      slowestMinutes: Math.max(d.schedule.slowestMinutes, Math.max(1, minutes)),
                    })
                  }
                />
                <DurationField
                  label="Cut-off"
                  minutes={d.schedule.slowestMinutes}
                  accent="#f59e0b"
                  onChange={minutes =>
                    onChange(d.id, { slowestMinutes: Math.max(d.schedule.fastestMinutes, minutes) })
                  }
                />
              </div>

              <div className="flex gap-2">
                <label className="flex-1 min-w-0">
                  <span className="block text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: '#64748b' }}>
                    Wave spread
                  </span>
                  <span
                    className="flex items-center rounded-lg overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.14)' }}
                  >
                    <input
                      type="number"
                      min={0}
                      value={d.schedule.startWindowMinutes ?? 0}
                      onChange={e => onChange(d.id, { startWindowMinutes: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-full min-w-0 bg-transparent px-2 py-1.5 text-sm font-bold tabular-nums outline-none"
                      style={{ color: '#cbd5e1' }}
                    />
                    <span className="text-[10px] font-bold pr-2" style={{ color: '#475569' }}>min</span>
                  </span>
                </label>
                <label className="flex-1 min-w-0">
                  <span className="block text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: '#64748b' }}>
                    Starters
                  </span>
                  <span
                    className="flex items-center rounded-lg overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.14)' }}
                  >
                    <Users className="w-3 h-3 ml-2 flex-shrink-0" style={{ color: '#475569' }} />
                    <input
                      type="number"
                      min={0}
                      value={d.schedule.participants ?? 0}
                      onChange={e => onChange(d.id, { participants: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-full min-w-0 bg-transparent px-2 py-1.5 text-sm font-bold tabular-nums outline-none"
                      style={{ color: '#cbd5e1' }}
                    />
                  </span>
                </label>
              </div>

              {/* Pacing model */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>
                  Pacing
                </span>
                <div className="flex rounded-lg overflow-hidden ml-auto" style={{ border: '1px solid rgba(148,163,184,0.14)' }}>
                  {(['terrain', 'linear'] as const).map(model => {
                    const active = (d.schedule.pacing ?? 'terrain') === model
                    const disabled = model === 'terrain' && !d.course.hasElevation
                    return (
                      <button
                        key={model}
                        disabled={disabled}
                        onClick={() => onChange(d.id, { pacing: model })}
                        className="px-2.5 py-1 text-[10px] font-bold capitalize transition-colors disabled:opacity-35"
                        style={{
                          background: active ? `${d.color}22` : 'transparent',
                          color: active ? d.color : '#64748b',
                        }}
                        title={
                          disabled
                            ? 'This GPX carries no elevation, so gradient pacing is unavailable'
                            : model === 'terrain'
                              ? 'Weight pace by gradient — the pack bunches on the climbs'
                              : 'Even pace along the whole course'
                        }
                      >
                        {model}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Live readout at the playhead */}
              <div
                className="grid grid-cols-3 gap-1.5 pt-1.5"
                style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}
              >
                <Readout label="On course" value={String(field?.onCourse ?? 0)} color={d.color} />
                <Readout
                  label="Leader"
                  value={field && field.leaderMeters >= 0 ? `${(field.leaderMeters / 1000).toFixed(1)}k` : '—'}
                  color="#34d399"
                />
                <Readout
                  label="Tail"
                  value={field && field.tailMeters >= 0 ? `${(field.tailMeters / 1000).toFixed(1)}k` : '—'}
                  color="#f59e0b"
                />
              </div>

              <div className="flex items-center gap-1.5 text-[10px]" style={{ color: '#475569' }}>
                <Flag className="w-3 h-3" />
                Course clear {formatStamp(cutoffMs)} · {formatDuration(d.schedule.slowestMinutes)} on the clock
              </div>
              {(coverage[d.id]?.worstGapMeters ?? 0) > 0 && (
                <div className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: '#f87171' }}>
                  <ShieldAlert className="w-3 h-3" />
                  Worst gap {(coverage[d.id].worstGapMeters / 1000).toFixed(1)} km of occupied course
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Readout({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <div className="text-[8px] font-bold uppercase tracking-widest" style={{ color: '#475569' }}>{label}</div>
      <div className="text-sm font-black tabular-nums" style={{ color }}>{value}</div>
    </div>
  )
}
