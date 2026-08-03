'use client'

import { useEffect, useState } from 'react'
import { X, MapPin, Move, Archive, ArchiveRestore, Crosshair, Check } from 'lucide-react'
import { POI_CONFIGS } from '@/lib/constants'
import { PoiIcon, CUSTOM_POI_ICON_OPTIONS } from '@/lib/poi-icons'
import type { PointOfInterest, POIType } from '@/lib/types'

export interface PoiPatch {
  name?: string
  description?: string
  type?: string
  icon?: string
}

interface Props {
  poi: PointOfInterest
  onClose: () => void
  onSave: (poiId: string, patch: PoiPatch) => Promise<void>
  onMove: (poiId: string) => void
  onArchive: (poiId: string) => Promise<void>
  onRestore: (poiId: string) => Promise<void>
  onViewOnMap: (point: { lng: number; lat: number }) => void
}

/**
 * Right-side detail drawer for a point of interest — the POI counterpart to the
 * incident and medic drawers. Everything about a live point is editable here:
 * what it is, what it's called, the note the team reads, and whether it is on
 * the board at all.
 *
 * Points added locally in this session (no server id yet) are shown read-only —
 * there is nothing to PATCH until the event is saved.
 */
export default function PoiDrawer({ poi, onClose, onSave, onMove, onArchive, onRestore, onViewOnMap }: Props) {
  const [type, setType] = useState<string>(poi.type)
  const [name, setName] = useState(poi.name ?? '')
  const [description, setDescription] = useState(poi.description ?? '')
  const [icon, setIcon] = useState(poi.icon ?? CUSTOM_POI_ICON_OPTIONS[0].key)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  // Reload the form whenever the drawer switches to a different point (or the
  // open one changes underneath us via a live broadcast).
  useEffect(() => {
    setType(poi.type)
    setName(poi.name ?? '')
    setDescription(poi.description ?? '')
    setIcon(poi.icon ?? CUSTOM_POI_ICON_OPTIONS[0].key)
    setSaved(false)
  }, [poi.id, poi.type, poi.name, poi.description, poi.icon])

  const config = POI_CONFIGS.find(c => c.type === type) ?? POI_CONFIGS[POI_CONFIGS.length - 1]
  // Locally-added points have no server id, so nothing can be persisted yet.
  const persisted = !poi.id.startsWith('local-')
  const dirty =
    type !== poi.type ||
    name !== (poi.name ?? '') ||
    description !== (poi.description ?? '') ||
    (type === 'custom' && icon !== (poi.icon ?? CUSTOM_POI_ICON_OPTIONS[0].key))

  async function handleSave() {
    if (!dirty || saving) return
    setSaving(true)
    try {
      await onSave(poi.id, {
        type,
        name,
        description,
        // Dropping the custom type drops its glyph, so the point falls back to
        // its type icon instead of keeping a stale one.
        icon: type === 'custom' ? icon : '',
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } finally {
      setSaving(false)
    }
  }

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-y-0 right-0 z-40 flex flex-col"
      style={{
        width: 'min(92vw, 400px)',
        background: 'rgba(8,15,28,0.99)',
        borderLeft: '1px solid rgba(148,163,184,0.12)',
        boxShadow: '-24px 0 80px rgba(0,0,0,0.6)',
      }}
    >
      {/* Type accent bar */}
      <div style={{ height: 4, background: config.color }} />

      <div className="flex items-center gap-3 px-5 pt-4 pb-4" style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
        <div
          className="flex items-center justify-center rounded-2xl flex-shrink-0"
          style={{ width: 44, height: 44, background: `${config.color}26`, border: `1px solid ${config.color}66` }}
        >
          <PoiIcon type={type as POIType} icon={type === 'custom' ? icon : undefined} size={22} color={config.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-bold text-slate-100 truncate leading-tight">
            {poi.name || config.label}
          </div>
          <div className="text-xs font-semibold mt-0.5" style={{ color: config.color }}>
            {config.label}
            {poi.archived && <span style={{ color: '#64748b' }}> · Archived</span>}
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl flex-shrink-0" style={{ color: '#64748b', background: 'rgba(255,255,255,0.04)' }}>
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
        {poi.archived && (
          <div
            className="text-[12px] leading-snug rounded-xl px-3 py-2.5"
            style={{ background: 'rgba(100,116,139,0.12)', color: '#94a3b8', border: '1px solid rgba(100,116,139,0.2)' }}
          >
            This point is archived — nobody in the field sees it. Restore it to put it back on the board.
          </div>
        )}

        {/* Coordinates */}
        <div className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-1.5 text-[12px] font-mono" style={{ color: '#6b7f9a' }}>
            <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
            {poi.coordinates[1].toFixed(5)}, {poi.coordinates[0].toFixed(5)}
          </div>
          <button
            onClick={() => onViewOnMap({ lng: poi.coordinates[0], lat: poi.coordinates[1] })}
            className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg"
            style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)' }}
          >
            <Crosshair className="w-3.5 h-3.5" /> Centre
          </button>
        </div>

        {!persisted ? (
          <div className="text-[12px] leading-snug rounded-xl px-3 py-2.5" style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.22)' }}>
            This point was added in this session and hasn&apos;t been saved to the event yet, so it can&apos;t be edited here.
          </div>
        ) : (
          <>
            {/* Type */}
            <div>
              <div className="text-[10px] font-black tracking-widest mb-2.5" style={{ color: '#4A5F7A' }}>TYPE</div>
              <div className="flex flex-wrap gap-2">
                {POI_CONFIGS.map(c => {
                  const active = type === c.type
                  return (
                    <button
                      key={c.type}
                      onClick={() => setType(c.type)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[12px] font-bold transition-colors"
                      style={{
                        background: active ? `${c.color}22` : 'rgba(255,255,255,0.03)',
                        border: `1.5px solid ${active ? c.color : 'rgba(148,163,184,0.18)'}`,
                        color: active ? c.color : '#94a3b8',
                      }}
                    >
                      <PoiIcon type={c.type} size={13} color={active ? c.color : '#94a3b8'} />
                      {c.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Custom glyph */}
            {type === 'custom' && (
              <div>
                <div className="text-[10px] font-black tracking-widest mb-2.5" style={{ color: '#4A5F7A' }}>ICON</div>
                <div className="flex flex-wrap gap-2">
                  {CUSTOM_POI_ICON_OPTIONS.map(opt => {
                    const active = icon === opt.key
                    return (
                      <button
                        key={opt.key}
                        onClick={() => setIcon(opt.key)}
                        title={opt.label}
                        className="flex items-center justify-center rounded-xl transition-colors"
                        style={{
                          width: 36,
                          height: 36,
                          background: active ? 'rgba(52,211,153,0.14)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${active ? 'rgba(52,211,153,0.5)' : 'rgba(148,163,184,0.15)'}`,
                        }}
                      >
                        <opt.Icon className="w-4 h-4" style={{ color: active ? '#34d399' : '#94a3b8' }} />
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Name */}
            <div>
              <div className="text-[10px] font-black tracking-widest mb-2.5" style={{ color: '#4A5F7A' }}>NAME</div>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Aid station 2"
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.15)', color: '#e2e8f0' }}
              />
            </div>

            {/* Description */}
            <div>
              <div className="text-[10px] font-black tracking-widest mb-2.5" style={{ color: '#4A5F7A' }}>DESCRIPTION</div>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                placeholder="Anything the team should know…"
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.15)', color: '#e2e8f0' }}
              />
            </div>

            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-bold transition-opacity"
              style={{
                background: saved ? 'rgba(34,197,94,0.16)' : '#22c55e',
                color: saved ? '#4ade80' : '#04121f',
                opacity: dirty || saved ? 1 : 0.4,
                cursor: dirty && !saving ? 'pointer' : 'default',
              }}
            >
              {saved ? (<><Check className="w-4 h-4" /> Saved</>) : saving ? 'Saving…' : 'Save changes'}
            </button>
          </>
        )}

        {/* Point actions */}
        {persisted && (
          <div className="flex flex-col gap-2 pt-1">
            <button
              onClick={() => onMove(poi.id)}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[13px] font-bold"
              style={{ background: 'rgba(56,189,248,0.08)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)' }}
            >
              <Move className="w-4 h-4" /> Move point
            </button>
            {poi.archived ? (
              <button
                onClick={() => void run(() => onRestore(poi.id))}
                disabled={busy}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[13px] font-bold"
                style={{ background: 'rgba(34,197,94,0.08)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.28)' }}
              >
                <ArchiveRestore className="w-4 h-4" /> Restore point
              </button>
            ) : (
              <button
                onClick={() => void run(() => onArchive(poi.id))}
                disabled={busy}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[13px] font-bold"
                style={{ background: 'rgba(255,255,255,0.03)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.22)' }}
              >
                <Archive className="w-4 h-4" /> Archive point
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
