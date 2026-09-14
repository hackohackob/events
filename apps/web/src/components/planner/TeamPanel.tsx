'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Clock,
  Eye,
  EyeOff,
  MapPin,
  Plus,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { VEHICLE_TYPES, VEHICLE_TYPE_META } from '@events/contracts'
import type { PlanMedic, PlanStation, VehicleType } from '@events/contracts'
import type { MedicTimeline } from '@/lib/planner/schedule'
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
}

function stationsInOrder(medic: PlanMedic): PlanStation[] {
  return [...medic.stations].sort(
    (a, b) => new Date(a.arriveAt).getTime() - new Date(b.arriveAt).getTime(),
  )
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
        const stations = stationsInOrder(medic)
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
                <div className="flex gap-2">
                  <input
                    value={medic.name}
                    onChange={e => onPatchMedic(medic.id, { name: e.target.value })}
                    className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-xs font-semibold outline-none"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(148,163,184,0.14)',
                      color: '#e2e8f0',
                    }}
                  />
                  <select
                    value={medic.vehicleType}
                    onChange={e => onPatchMedic(medic.id, { vehicleType: e.target.value as VehicleType })}
                    className="rounded-lg px-2 py-1.5 text-xs font-semibold outline-none"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(148,163,184,0.14)',
                      color: '#cbd5e1',
                    }}
                    title="Vehicle — sets how long every move takes"
                  >
                    {VEHICLE_TYPES.map(v => (
                      <option key={v} value={v} style={{ background: '#0f172a' }}>
                        {VEHICLE_TYPE_META[v].icon} {VEHICLE_TYPE_META[v].label}
                      </option>
                    ))}
                  </select>
                </div>

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
