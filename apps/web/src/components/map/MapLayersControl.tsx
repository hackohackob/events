'use client'

import { Map as MapIcon, Mountain, Satellite } from 'lucide-react'
import type { BaseLayer } from './MapClient'

/**
 * Compact floating map-layer control for maps without the full Layers panel
 * (the create/edit wizard steps): normal ↔ satellite base switch + a 3D
 * terrain toggle, in one small icon pill — the wizard is sometimes used on
 * phones, so it deliberately stays tiny.
 */
export default function MapLayersControl({
  baseLayer,
  onBaseLayer,
  map3d,
  onToggle3d,
  className = 'absolute bottom-4 left-4',
}: {
  baseLayer: BaseLayer
  onBaseLayer: (layer: BaseLayer) => void
  map3d: boolean
  onToggle3d: () => void
  className?: string
}) {
  const itemClass = 'flex items-center justify-center w-8 h-8 rounded-lg transition-all'
  return (
    <div
      className={`${className} flex items-center gap-1 p-1 rounded-xl`}
      style={{
        zIndex: 10,
        background: 'rgba(10,18,34,0.92)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(148,163,184,0.18)',
      }}
    >
      <button
        type="button"
        onClick={() => onBaseLayer('streets')}
        title="Normal map"
        className={itemClass}
        style={{
          background: baseLayer === 'streets' ? 'rgba(59,130,246,0.22)' : 'transparent',
          color: baseLayer === 'streets' ? '#93c5fd' : '#64748b',
        }}
      >
        <MapIcon className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => onBaseLayer('satellite')}
        title="Satellite"
        className={itemClass}
        style={{
          background: baseLayer === 'satellite' ? 'rgba(59,130,246,0.22)' : 'transparent',
          color: baseLayer === 'satellite' ? '#93c5fd' : '#64748b',
        }}
      >
        <Satellite className="w-4 h-4" />
      </button>
      <div className="w-px h-5" style={{ background: 'rgba(148,163,184,0.18)' }} />
      <button
        type="button"
        onClick={onToggle3d}
        title="Toggle 3D terrain"
        className={itemClass}
        style={{
          background: map3d ? 'rgba(139,92,246,0.22)' : 'transparent',
          color: map3d ? '#c4b5fd' : '#64748b',
        }}
      >
        <Mountain className="w-4 h-4" />
      </button>
    </div>
  )
}
