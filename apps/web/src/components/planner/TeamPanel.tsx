'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Clock,
  Eye,
  EyeOff,
  Lock,
  MapPin,
  Plus,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { VEHICLE_TYPES, VEHICLE_TYPE_META, planSweeps, planVehicleAt } from '@events/contracts'
import type { PlanMedic, PlanStation, PlanSweepJoin, VehicleType } from '@events/contracts'
import type { MedicTimeline, ResolvedSweep } from '@/lib/planner/schedule'
import type { SweepWarning } from '@/lib/planner/sweep-check'
import { formatDuration, formatStamp, formatTime } from '@/lib/planner/itinerary'

interface Props {
  medics: PlanMedic[]
  timelines: Record<string, MedicTimeline>
  selectedMedicId: string | null
  onSelectMedic: (id: string | null) => void
  cursorMs: number
  onAddMedic: () => void
  onPatchMedic: (id: string, patch: Partial<PlanMedic>) => void
  onRemoveMedic: (id: string) => void
  onPatchStation: (medicId: string, stationId: string, patch: Partial<PlanStation>) => void
  onRemoveStation: (medicId: string, stationId: string) => void
  /** Focus the map on a station. */
  onFocusStation: (medicId: string, stationId: string) => void
  /** Put the medic on this vehicle from the playhead onwards. */
  onSetVehicle: (medicId: string, vehicle: VehicleType) => void
  onRemoveVehicleChange: (medicId: string, changeId: string) => void
  /** Disciplines available to sweep. */
  disciplines: Array<{ id: string; name: string; color: string; hasCourse: boolean }>
  onToggleSweeper: (medicId: string, disciplineId: string) => void
  onSetSweepJoin: (medicId: string, disciplineId: string, joinFrom: PlanSweepJoin) => void
  /** The medic's sweeps with their join point already worked out. */
  sweepsFor: (medic: PlanMedic) => ResolvedSweep[]
  /** Vehicle-vs-course problems with a sweep, if any. */
  sweepWarningsFor: (medic: PlanMedic, disciplineId: string) => SweepWarning[]
}

function toLocalInput(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

export default function TeamPanel({
  medics,
  timelines,
  selectedMedicId,
  onSelectMedic,
  cursorMs,
  onAddMedic,
  onPatchMedic,
  onRemoveMedic,
  onPatchStation,
  onRemoveStation,
  onFocusStation,
  onSetVehicle,
  onRemoveVehicleChange,
  disciplines,
  onToggleSweeper,
  onSetSweepJoin,
  sweepsFor,
  sweepWarningsFor,
}: Props) {
  const [editingStation, setEditingStation] = useState<string | null>(null)

  return (
    <div className="p-4 space-y-2.5">
      <button
        onClick={onAddMedic}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-[0.98]"
        style={{
          background: 'rgba(52,211,153,0.08)',
          border: '1px dashed rgba(52,211,153,0.35)',
          color: '#34d399',
        }}
      >
        <UserPlus className="w-3.5 h-3.5" /> Add a planned unit
      </button>

      {medics.length === 0 && (
        <p className="text-xs text-center py-6" style={{ color: '#64748b' }}>
          No medics on the roster yet. Assign the team to the event, or add planned units here while
          you work out how many you need.
        </p>
      )}

      {medics.map(medic => {
        const selected = medic.id === selectedMedicId
        const timeline = timelines[medic.id]
        // The timeline's own station list, so sweep endpoints appear in the
        // panel exactly where they appear on the lane.
        const stations = timeline?.stations ?? medic.stations
        const conflicts = timeline?.conflicts.length ?? 0
        return (
          <div
            key={medic.id}
            className="rounded-2xl overflow-hidden transition-all"
            style={{
              background: selected ? `${medic.color}0f` : 'rgba(255,255,255,0.025)',
              border: `1px solid ${selected ? `${medic.color}66` : 'rgba(148,163,184,0.1)'}`,
              opacity: medic.hidden ? 0.5 : 1,
            }}
          >
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button
                onClick={() => onSelectMedic(selected ? null : medic.id)}
                className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
              >
                <span
                  className="flex items-center justify-center rounded-full text-sm flex-shrink-0"
                  style={{
                    width: 30,
                    height: 30,
                    background: 'rgba(2,8,18,0.8)',
                    border: `1.5px solid ${medic.color}`,
                  }}
                >
                  {(VEHICLE_TYPE_META[medic.vehicleType] ?? VEHICLE_TYPE_META.foot).icon}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold truncate" style={{ color: '#e2e8f0' }}>
                    {medic.name}
                  </span>
                  <span className="flex items-center gap-2 text-[10px]" style={{ color: '#64748b' }}>
                    {planSweeps(medic).length > 0 && (
                      <span style={{ color: medic.color }}>
                        sweeps {planSweeps(medic).length === 1 ? '1 course' : `${planSweeps(medic).length} courses`} ·
                      </span>
                    )}
                    <span>{stations.length} {stations.length === 1 ? 'position' : 'positions'}</span>
                    {timeline && timeline.travelMinutes > 0 && (
                      <span>· {formatDuration(timeline.travelMinutes)} travelling</span>
                    )}
                    {conflicts > 0 && (
                      <span className="flex items-center gap-0.5" style={{ color: '#f87171' }}>
                        <AlertTriangle className="w-2.5 h-2.5" /> {conflicts}
                      </span>
                    )}
                  </span>
                </span>
              </button>
              <button
                onClick={() => onPatchMedic(medic.id, { hidden: !medic.hidden })}
                className="p-1.5 rounded-lg flex-shrink-0"
                style={{ color: '#475569' }}
                title={medic.hidden ? 'Show on map' : 'Hide from map'}
              >
                {medic.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>

            {selected && (
              <div className="px-3 pb-3 space-y-2.5">
                <input
                  value={medic.name}
                  onChange={e => onPatchMedic(medic.id, { name: e.target.value })}
                  className="w-full rounded-lg px-2 py-1.5 text-xs font-semibold outline-none"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(148,163,184,0.14)',
                    color: '#e2e8f0',
                  }}
                />

                {/* Vehicle is a property of a MOMENT, not of the medic: picking
                    one here changes what they drive from the playhead onwards
                    and leaves every earlier leg on whatever it was. */}
                <div>
                  <div className="flex items-center gap-2">
                    <select
                      value={planVehicleAt(medic, cursorMs)}
                      onChange={e => onSetVehicle(medic.id, e.target.value as VehicleType)}
                      className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-xs font-semibold outline-none"
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(148,163,184,0.14)',
                        color: '#cbd5e1',
                      }}
                      title="Sets the vehicle from the playhead onwards — earlier legs keep the old one"
                    >
                      {VEHICLE_TYPES.map(v => (
                        <option key={v} value={v} style={{ background: '#0f172a' }}>
                          {VEHICLE_TYPE_META[v].icon} {VEHICLE_TYPE_META[v].label}
                        </option>
                      ))}
                    </select>
                    <span className="text-[9px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: '#475569' }}>
                      from {formatTime(cursorMs)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    <span
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold"
                      style={{ background: 'rgba(255,255,255,0.04)', color: '#94a3b8' }}
                      title="What they start the event on"
                    >
                      {(VEHICLE_TYPE_META[medic.vehicleType] ?? VEHICLE_TYPE_META.foot).icon} from start
                    </span>
                    {(medic.vehicleChanges ?? []).map(change => (
                      <span
                        key={change.id}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold"
                        style={{ background: `${medic.color}1f`, color: medic.color }}
                      >
                        {(VEHICLE_TYPE_META[change.vehicleType] ?? VEHICLE_TYPE_META.foot).icon}{' '}
                        {formatStamp(new Date(change.at).getTime())}
                        <button
                          onClick={() => onRemoveVehicleChange(medic.id, change.id)}
                          title="Drop this swap"
                          style={{ color: 'inherit', opacity: 0.7 }}
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Sweeping: one tap per course. A sweeper has no postings for
                    that window — they ride the back of the field — so this is a
                    toggle, not another thing to place on the map. */}
                {disciplines.length > 0 && (
                  <div>
                    <span className="block text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: '#64748b' }}>
                      Sweeper for
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {disciplines.map(d => {
                        const on = planSweeps(medic).some(s => s.disciplineId === d.id)
                        return (
                          <button
                            key={d.id}
                            disabled={!d.hasCourse}
                            onClick={() => onToggleSweeper(medic.id, d.id)}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95 disabled:opacity-30"
                            style={{
                              background: on ? `${d.color}22` : 'rgba(255,255,255,0.03)',
                              border: `1px solid ${on ? d.color : 'rgba(148,163,184,0.14)'}`,
                              color: on ? d.color : '#64748b',
                            }}
                            title={
                              d.hasCourse
                                ? `Ride the back of ${d.name} from the start until the last participant is off the course`
                                : 'This discipline has no GPX track to sweep'
                            }
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ background: on ? d.color : '#334155' }}
                            />
                            {d.name}
                          </button>
                        )
                      })}
                    </div>

                    {/* How each sweep starts. "From my post" is the normal
                        case — the medic works a position and picks up the tail
                        when it reaches them — so the time is computed, not
                        typed: it is whenever the last participant gets there. */}
                    {sweepsFor(medic).map(sweep => (
                      <div
                        key={sweep.disciplineId}
                        className="mt-1.5 px-2 py-1.5 rounded-xl"
                        style={{ background: `${sweep.color}12`, border: `1px solid ${sweep.color}33` }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold flex-1 truncate" style={{ color: sweep.color }}>
                            {sweep.label}
                          </span>
                          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(148,163,184,0.16)' }}>
                            {(
                              [
                                ['post', 'From my post'],
                                ['start', 'From the gun'],
                              ] as Array<[PlanSweepJoin, string]>
                            ).map(([value, text]) => (
                              <button
                                key={value}
                                onClick={() => onSetSweepJoin(medic.id, sweep.disciplineId, value)}
                                className="px-2 py-0.5 text-[9px] font-bold transition-colors"
                                style={{
                                  background: sweep.joinFrom === value ? `${sweep.color}33` : 'transparent',
                                  color: sweep.joinFrom === value ? sweep.color : '#64748b',
                                }}
                              >
                                {text}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="text-[9px] mt-1" style={{ color: sweep.fellBackToStart ? '#f59e0b' : '#64748b' }}>
                          {sweep.fellBackToStart
                            ? 'No post is manned before the tail passes — joining at the gun instead'
                            : sweep.joinFrom === 'post'
                              ? `Last runner reaches ${sweep.postLabel} at ${formatTime(sweep.startMs)} · clear ${formatTime(sweep.endMs)}`
                              : `Off the line ${formatTime(sweep.startMs)} · clear ${formatTime(sweep.endMs)}`}
                        </div>
                        {sweepWarningsFor(medic, sweep.disciplineId).map((warning, wi) => (
                          <div
                            key={wi}
                            className="flex items-start gap-1.5 mt-1.5 px-1.5 py-1 rounded-lg text-[9px] font-semibold"
                            style={{
                              background:
                                warning.level === 'blocker' ? 'rgba(248,113,113,0.12)' : 'rgba(245,158,11,0.1)',
                              color: warning.level === 'blocker' ? '#fca5a5' : '#fcd34d',
                            }}
                          >
                            <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0 mt-px" />
                            <span>{warning.message}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {stations.length === 0 ? (
                  <div
                    className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-[11px]"
                    style={{ background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.2)', color: '#7dd3fc' }}
                  >
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>
                      Click anywhere on the map to post {medic.name.split(' ')[0]} there at{' '}
                      <strong>{formatTime(cursorMs)}</strong>. Drop near a point of interest and it snaps to it.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {stations.map((station, i) => {
                      const arriveMs = new Date(station.arriveAt).getTime()
                      const move = timeline?.segments.find(s => s.kind === 'move' && s.stationId === station.id)
                      const editing = editingStation === station.id
                      const sweep = (station as {
                        sweep?: { edge: 'start' | 'end'; joinFrom?: PlanSweepJoin }
                      }).sweep
                      if (sweep) {
                        // A sweep endpoint is owned by the discipline's schedule
                        // — re-timing it here would just be overwritten.
                        return (
                          <div
                            key={station.id}
                            className="flex items-center gap-2 px-2.5 py-2 rounded-xl"
                            style={{ background: `${medic.color}12`, border: `1px dashed ${medic.color}55` }}
                          >
                            <span
                              className="flex items-center justify-center rounded-full text-[9px] font-black flex-shrink-0"
                              style={{ width: 18, height: 18, background: `${medic.color}22`, color: medic.color }}
                            >
                              {i + 1}
                            </span>
                            <button
                              onClick={() => onFocusStation(medic.id, station.id)}
                              className="flex-1 min-w-0 text-left"
                            >
                              <span className="block text-xs font-bold truncate" style={{ color: '#e2e8f0' }}>
                                {sweep.edge === 'end'
                                  ? `Sweep complete — ${station.label.replace(/ finish$/, '')}`
                                  : sweep.joinFrom === 'post'
                                    ? `Last runner here — go with them (${station.label.replace(/ tail$/, '')})`
                                    : `Start sweeping — ${station.label.replace(/ start$/, '')}`}
                              </span>
                              <span className="flex items-center gap-1.5 text-[10px]" style={{ color: '#64748b' }}>
                                <Clock className="w-2.5 h-2.5" />
                                {formatStamp(arriveMs)}
                                {move && (
                                  <span style={{ color: move.tight ? '#f87171' : '#475569' }}>
                                    · {formatDuration((move.toMs - move.fromMs) / 60000)} to get here
                                  </span>
                                )}
                              </span>
                            </button>
                            <Lock className="w-3 h-3 flex-shrink-0" style={{ color: '#475569' }} />
                          </div>
                        )
                      }
                      return (
                        <div
                          key={station.id}
                          className="rounded-xl overflow-hidden"
                          style={{
                            background: 'rgba(255,255,255,0.03)',
                            border: `1px solid ${move?.tight ? 'rgba(248,113,113,0.4)' : 'rgba(148,163,184,0.1)'}`,
                          }}
                        >
                          <div className="flex items-center gap-2 px-2.5 py-2">
                            <span
                              className="flex items-center justify-center rounded-full text-[9px] font-black flex-shrink-0"
                              style={{ width: 18, height: 18, background: `${medic.color}22`, color: medic.color }}
                            >
                              {i + 1}
                            </span>
                            <button
                              onClick={() => onFocusStation(medic.id, station.id)}
                              className="flex-1 min-w-0 text-left"
                            >
                              <span className="block text-xs font-bold truncate" style={{ color: '#e2e8f0' }}>
                                {station.label}
                              </span>
                              <span className="flex items-center gap-1.5 text-[10px]" style={{ color: '#64748b' }}>
                                <Clock className="w-2.5 h-2.5" />
                                {formatStamp(arriveMs)}
                                {move && (
                                  <span style={{ color: move.tight ? '#f87171' : '#475569' }}>
                                    · {formatDuration((move.toMs - move.fromMs) / 60000)}
                                    {move.travelSource === 'routed' ? ' routed' : ''}
                                    {move.tight ? ` · ${formatDuration(move.shortfallMinutes ?? 0)} short` : ''}
                                  </span>
                                )}
                              </span>
                            </button>
                            {(station.via?.length ?? 0) > 0 && (
                              <button
                                onClick={() => onPatchStation(medic.id, station.id, { via: undefined })}
                                className="px-1.5 py-0.5 rounded text-[9px] font-bold flex-shrink-0"
                                style={{ background: `${medic.color}22`, color: medic.color }}
                                title="This journey is routed through waypoints — click to take them off"
                              >
                                via {station.via!.length}
                              </button>
                            )}
                            <button
                              onClick={() => setEditingStation(editing ? null : station.id)}
                              className="p-1 rounded text-[10px] font-bold"
                              style={{ color: editing ? medic.color : '#475569' }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => onRemoveStation(medic.id, station.id)}
                              className="p-1 rounded"
                              style={{ color: '#475569' }}
                              title="Remove this position"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>

                          {editing && (
                            <div className="px-2.5 pb-2.5 space-y-1.5">
                              <input
                                value={station.label}
                                onChange={e => onPatchStation(medic.id, station.id, { label: e.target.value })}
                                placeholder="Position name"
                                className="w-full rounded-lg px-2 py-1.5 text-xs outline-none"
                                style={{
                                  background: 'rgba(255,255,255,0.04)',
                                  border: '1px solid rgba(148,163,184,0.14)',
                                  color: '#e2e8f0',
                                }}
                              />
                              <input
                                type="datetime-local"
                                value={toLocalInput(station.arriveAt)}
                                onChange={e => {
                                  const at = new Date(e.target.value)
                                  if (!Number.isNaN(at.getTime())) {
                                    onPatchStation(medic.id, station.id, { arriveAt: at.toISOString() })
                                  }
                                }}
                                className="w-full rounded-lg px-2 py-1.5 text-xs outline-none"
                                style={{
                                  background: 'rgba(255,255,255,0.04)',
                                  border: '1px solid rgba(148,163,184,0.14)',
                                  color: '#e2e8f0',
                                  colorScheme: 'dark',
                                }}
                              />
                              {i > 0 && (
                                <label className="flex items-center gap-2">
                                  <span className="text-[9px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: '#64748b' }}>
                                    Travel
                                  </span>
                                  <span
                                    className="flex items-center flex-1 rounded-lg overflow-hidden"
                                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.14)' }}
                                  >
                                    <input
                                      type="number"
                                      min={0}
                                      value={Math.round(station.travelMinutes ?? 0)}
                                      onChange={e =>
                                        onPatchStation(medic.id, station.id, {
                                          travelMinutes: Math.max(0, Number(e.target.value) || 0),
                                          travelSource: 'manual',
                                        })
                                      }
                                      className="w-full min-w-0 bg-transparent px-2 py-1.5 text-xs font-bold tabular-nums outline-none"
                                      style={{ color: '#cbd5e1' }}
                                    />
                                    <span className="text-[10px] font-bold pr-2" style={{ color: '#475569' }}>min</span>
                                  </span>
                                  {station.travelSource === 'manual' && (
                                    <button
                                      onClick={() =>
                                        onPatchStation(medic.id, station.id, {
                                          travelMinutes: undefined,
                                          travelSource: undefined,
                                        })
                                      }
                                      className="text-[9px] font-bold"
                                      style={{ color: '#38bdf8' }}
                                      title="Go back to the measured route time"
                                    >
                                      auto
                                    </button>
                                  )}
                                </label>
                              )}
                              <textarea
                                value={station.note ?? ''}
                                onChange={e => onPatchStation(medic.id, station.id, { note: e.target.value })}
                                placeholder="Briefing note (optional)"
                                rows={2}
                                className="w-full rounded-lg px-2 py-1.5 text-xs outline-none resize-none"
                                style={{
                                  background: 'rgba(255,255,255,0.04)',
                                  border: '1px solid rgba(148,163,184,0.14)',
                                  color: '#cbd5e1',
                                }}
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                    <div
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold"
                      style={{ color: '#64748b', border: '1px dashed rgba(148,163,184,0.2)' }}
                    >
                      <Plus className="w-3 h-3" /> Move the clock, then click the map to add the next
                    </div>
                  </div>
                )}

                {!medic.medicId && (
                  <button
                    onClick={() => onRemoveMedic(medic.id)}
                    className="w-full py-1.5 rounded-lg text-[10px] font-bold"
                    style={{ color: '#f87171', background: 'rgba(248,113,113,0.08)' }}
                  >
                    Remove this planned unit
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
