'use client'

import { useEffect, useState } from 'react'
import { POI_CONFIGS } from '@/lib/constants'
import { PoiIcon, CUSTOM_POI_ICON_OPTIONS } from '@/lib/poi-icons'
import type { POIType } from '@/lib/types'

export interface NewPoiInput {
  lat: number
  lng: number
  type: string
  name?: string
  description?: string
  icon?: string
}

interface Props {
  coords: [number, number]
  onClose: () => void
  onCreate: (input: NewPoiInput) => Promise<void>
}

/**
 * Dashboard counterpart of the native app's long-press "New point of interest"
 * sheet: same fields, same endpoint, so the point is live for the whole team
 * the moment it's added.
 */
export default function NewPoiModal({ coords, onClose, onCreate }: Props) {
  const [type, setType] = useState<string>('medical-point')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState(CUSTOM_POI_ICON_OPTIONS[0].key)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the form for each fresh map click.
  useEffect(() => {
    setType('medical-point')
    setName('')
    setDescription('')
    setIcon(CUSTOM_POI_ICON_OPTIONS[0].key)
    setSaving(false)
    setError(null)
  }, [coords])

  const config = POI_CONFIGS.find(c => c.type === type) ?? POI_CONFIGS[POI_CONFIGS.length - 1]

  async function submit() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onCreate({
        lat: coords[1],
        lng: coords[0],
        type,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        icon: type === 'custom' ? icon : undefined,
      })
    } catch {
      setError("Couldn't add the point — check your connection and try again.")
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 50, background: 'rgba(5,10,20,0.82)', backdropFilter: 'blur(14px)' }}
      onClick={onClose}
    >
      <div
        className="relative flex flex-col gap-5 p-6 rounded-3xl overflow-y-auto"
        style={{
          maxWidth: 480, width: '90%', maxHeight: '90vh',
          background: 'rgba(8,15,28,0.97)',
          border: `1px solid ${config.color}44`,
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div>
          <div className="text-xs font-bold mb-1" style={{ color: '#64748b', letterSpacing: 1.5 }}>NEW POINT OF INTEREST</div>
          <div className="text-lg font-bold text-slate-100 font-mono">
            {coords[1].toFixed(5)}, {coords[0].toFixed(5)}
          </div>
        </div>

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
                  <PoiIcon type={c.type as POIType} size={13} color={active ? c.color : '#94a3b8'} />
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
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void submit() }}
            placeholder="e.g. Aid station 2"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.15)', color: '#e2e8f0' }}
          />
        </div>

        {/* Description */}
        <div>
          <div className="text-[10px] font-black tracking-widest mb-2.5" style={{ color: '#4A5F7A' }}>DESCRIPTION (OPTIONAL)</div>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            placeholder="Anything the team should know…"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.15)', color: '#e2e8f0' }}
          />
        </div>

        {error && (
          <div className="text-[12px] leading-snug rounded-xl px-3 py-2.5" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.22)' }}>
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => void submit()}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold"
            style={{ background: '#22c55e', color: '#04121f', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Adding…' : 'Add point'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)', color: '#64748b' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
