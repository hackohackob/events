'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, ChevronDown, Eye, EyeOff, Pencil, Trash2, X } from 'lucide-react'
import type { EventZone } from '@events/contracts'

const ZONE_COLORS = ['#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#14b8a6']

interface Props {
  zones: EventZone[]
  drawActive: boolean
  onToggleDraw: () => void
  /** A finished sketch waiting to be named/saved (ring of [lng, lat]). */
  pendingPolygon: [number, number][] | null
  onSavePending: (input: { name: string; color: string; alarm: boolean }) => void
  onCancelPending: () => void
  onToggleVisible: (zone: EventZone) => void
  onToggleAlarm: (zone: EventZone) => void
  onDelete: (zone: EventZone) => void
}

/**
 * Zones section, embedded as a collapsible block inside the Layers panel:
 * per-zone visibility/alarm toggles + delete, a freehand draw mode toggle,
 * and the save form shown once a sketch is finished. Zones are team-only —
 * participants never see them.
 */
export default function ZonesPanel({
  zones,
  drawActive,
  onToggleDraw,
  pendingPolygon,
  onSavePending,
  onCancelPending,
  onToggleVisible,
  onToggleAlarm,
  onDelete,
}: Props) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(ZONE_COLORS[0])
  const [alarm, setAlarm] = useState(false)
  const [open, setOpen] = useState(false)

  // Reset the form whenever a new sketch arrives, and pop the section open —
  // the save form must be visible right after drawing.
  useEffect(() => {
    if (pendingPolygon) {
      setName('')
      setAlarm(false)
      setOpen(true)
    }
  }, [pendingPolygon])

  return (
    <div className="flex flex-col gap-1.5" style={{ borderTop: '1px solid rgba(148,163,184,0.1)', marginTop: 8, paddingTop: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full"
        style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#334155' }}>
          Zones
        </span>
        <span className="flex items-center gap-1.5">
          {drawActive && <span className="text-[9px] font-bold" style={{ color: '#f59e0b' }}>drawing…</span>}
          <span className="text-[10px] font-bold" style={{ color: '#475569' }}>{zones.length}</span>
          <ChevronDown
            className="w-3.5 h-3.5 transition-transform"
            style={{ color: '#64748b', transform: open ? 'rotate(180deg)' : 'none' }}
          />
        </span>
      </button>

      {open && (
      <>
      {/* Zone rows */}
      {zones.map(zone => (
        <div
          key={zone.id}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
          style={{
            background: zone.visible ? `${zone.color}14` : 'rgba(255,255,255,0.03)',
            border: `1px solid ${zone.visible ? zone.color + '40' : 'rgba(148,163,184,0.08)'}`,
          }}
        >
          <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: zone.color }} />
          <span className="flex-1 text-xs font-medium truncate" style={{ color: zone.visible ? '#e2e8f0' : '#64748b' }}>
            {zone.name}
          </span>
          <button
            onClick={() => onToggleAlarm(zone)}
            title={zone.alarm ? 'Alarm on — medics entering this zone are alerted' : 'Alarm off'}
            style={{ color: zone.alarm ? '#f59e0b' : '#475569' }}
          >
            {zone.alarm ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => onToggleVisible(zone)}
            title={zone.visible ? 'Hide zone' : 'Show zone'}
            style={{ color: zone.visible ? '#22c55e' : '#475569' }}
          >
            {zone.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => { if (window.confirm(`Delete zone “${zone.name}”?`)) onDelete(zone) }}
            title="Delete zone"
            style={{ color: '#64748b' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {/* Save form for a finished sketch */}
      {pendingPolygon ? (
        <div className="flex flex-col gap-2 p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(245,158,11,0.35)' }}>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Zone name"
            className="w-full px-2 py-1.5 rounded-md text-xs"
            style={{ background: 'rgba(2,8,20,0.7)', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0', outline: 'none' }}
          />
          <div className="flex gap-1.5">
            {ZONE_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="w-5 h-5 rounded-md"
                style={{ background: c, border: color === c ? '2px solid #fff' : '2px solid transparent' }}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: '#cbd5e1' }}>
            <input type="checkbox" checked={alarm} onChange={e => setAlarm(e.target.checked)} style={{ accentColor: '#f59e0b' }} />
            <Bell className="w-3 h-3" style={{ color: '#f59e0b' }} /> Alarm medics entering
          </label>
          <div className="flex gap-1.5">
            <button
              onClick={() => onSavePending({ name: name.trim() || 'Zone', color, alarm })}
              className="flex-1 rounded-md py-1.5 text-[11px] font-bold"
              style={{ background: 'rgba(34,197,94,0.18)', border: '1px solid rgba(34,197,94,0.5)', color: '#22c55e' }}
            >
              Save zone
            </button>
            <button
              onClick={onCancelPending}
              className="rounded-md px-2 py-1.5"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.15)', color: '#94a3b8' }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={onToggleDraw}
          className="flex items-center justify-center gap-2 rounded-lg py-1.5 text-[11px] font-bold transition-all"
          style={{
            background: drawActive ? 'rgba(245,158,11,0.18)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${drawActive ? 'rgba(245,158,11,0.55)' : 'rgba(148,163,184,0.12)'}`,
            color: drawActive ? '#f59e0b' : '#94a3b8',
          }}
        >
          <Pencil className="w-3 h-3" />
          {drawActive ? 'Drawing — drag on the map' : 'Draw zone'}
        </button>
      )}
      </>
      )}
    </div>
  )
}
