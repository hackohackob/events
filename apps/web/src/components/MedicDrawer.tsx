'use client'

import { useState } from 'react'
import { X, BatteryMedium, Navigation, MapPin, Crosshair, AlertCircle } from 'lucide-react'
import type { MedicState } from '@events/contracts'
import type { LiveIncident } from '@/hooks/useLiveMap'

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  available:  { label: 'Available',  color: '#22c55e' },
  stationary: { label: 'Stationary', color: '#22c55e' },
  sweeper:    { label: 'Sweeper',    color: '#38bdf8' },
  rest:       { label: 'Rest',       color: '#a78bfa' },
  going_to:   { label: 'En route',   color: '#f59e0b' },
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

function lastSeen(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}

interface Props {
  medic: MedicState
  incidents: LiveIncident[]
  onClose: () => void
  onAssignToIncident: (medicId: string, incidentId: string) => void
  onClearDestination: (medicId: string) => void
}

/** Right-side detail drawer for a medic — status, telemetry, and dispatch actions. */
export default function MedicDrawer({ medic, incidents, onClose, onAssignToIncident, onClearDestination }: Props) {
  const [showAssign, setShowAssign] = useState(false)
  const st = STATUS_STYLE[medic.status] ?? STATUS_STYLE.available
  const openIncidents = incidents.filter(i => i.status !== 'resolved' && i.status !== 'closed')

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex flex-col" style={{ width: 'min(92vw, 400px)', background: 'rgba(8,15,28,0.99)', borderLeft: '1px solid rgba(148,163,184,0.12)', boxShadow: '-24px 0 80px rgba(0,0,0,0.6)' }}>
      {/* Status accent bar */}
      <div style={{ height: 4, background: st.color }} />
      <div className="flex items-center gap-3 px-5 pt-4 pb-4" style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
        <div className="relative flex-shrink-0">
          <div className="flex items-center justify-center rounded-2xl text-white font-bold" style={{ width: 44, height: 44, fontSize: 14, background: st.color }}>
            {initials(medic.name)}
          </div>
          <span className="absolute -right-1 -bottom-1 w-3.5 h-3.5 rounded-full" style={{ background: st.color, border: '2px solid #08111c' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-bold text-slate-100 truncate leading-tight">{medic.name}</div>
          <div className="text-xs font-semibold mt-0.5" style={{ color: st.color }}>{st.label}</div>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl flex-shrink-0" style={{ color: '#64748b', background: 'rgba(255,255,255,0.04)' }}>
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Telemetry */}
        <div className="grid grid-cols-2 gap-2">
          <Stat icon={<BatteryMedium className="w-3.5 h-3.5" />} label="Battery" value={medic.battery != null ? `${Math.round(medic.battery * 100)}%` : '—'} />
          <Stat icon={<Crosshair className="w-3.5 h-3.5" />} label="GPS" value={medic.accuracy != null ? `±${Math.round(medic.accuracy)} m` : '—'} />
          <Stat icon={<MapPin className="w-3.5 h-3.5" />} label="Position" value={`${medic.lat.toFixed(4)}, ${medic.lng.toFixed(4)}`} />
          <Stat icon={<Navigation className="w-3.5 h-3.5" />} label="Last seen" value={lastSeen(medic.lastSeenAt)} />
        </div>

        {medic.destination && (
          <div className="rounded-xl p-3" style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <div className="text-[10px] font-bold tracking-widest mb-1" style={{ color: '#f59e0b' }}>HEADING TO</div>
            <div className="text-sm text-slate-200">{medic.destination.label}</div>
            {medic.route && (
              <div className="text-xs mt-1" style={{ color: '#94a3b8' }}>
                {(medic.route.distanceMeters / 1000).toFixed(1)} km · {Math.max(1, Math.round(medic.route.durationMs / 60000))} min
              </div>
            )}
          </div>
        )}

        {/* Dispatch actions */}
        <div className="space-y-2 pt-1">
          {!showAssign ? (
            <button
              onClick={() => setShowAssign(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', boxShadow: '0 4px 14px rgba(239,68,68,0.3)' }}
            >
              <AlertCircle className="w-4 h-4" /> Dispatch to incident
            </button>
          ) : (
            <div className="rounded-xl p-2 space-y-1" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.12)' }}>
              <div className="text-[10px] font-bold tracking-widest px-1 py-1" style={{ color: '#64748b' }}>SELECT INCIDENT</div>
              {openIncidents.length === 0 ? (
                <div className="text-xs px-2 py-1.5" style={{ color: '#64748b' }}>No open incidents.</div>
              ) : (
                openIncidents.map(inc => (
                  <button
                    key={inc.id}
                    onClick={() => { onAssignToIncident(medic.medicId, inc.id); setShowAssign(false); onClose() }}
                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-all hover:bg-white/5"
                    style={{ color: '#e2e8f0' }}
                  >
                    <span className="capitalize">{inc.name ?? inc.type}</span>
                    <span style={{ color: '#f87171', fontWeight: 700 }}>Send →</span>
                  </button>
                ))
              )}
              <button onClick={() => setShowAssign(false)} className="w-full text-xs py-1.5 mt-1" style={{ color: '#64748b' }}>Cancel</button>
            </div>
          )}

          {medic.destination && (
            <button
              onClick={() => { onClearDestination(medic.medicId); onClose() }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{ background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.18)', color: '#94a3b8' }}
            >
              Clear destination
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.1)' }}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest mb-0.5" style={{ color: '#475569' }}>
        {icon} {label}
      </div>
      <div className="text-xs font-semibold text-slate-200 truncate">{value}</div>
    </div>
  )
}
