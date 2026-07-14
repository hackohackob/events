'use client'

import { Mountain } from 'lucide-react'

/**
 * Floating "3D" chip for maps without the full Layers panel (the create/edit
 * wizard steps) — drapes the base map over DEM terrain via MapWrapper's
 * `enable3d`. Same purple accent as the event page's 3D toggle.
 */
export default function Map3dToggle({
  on,
  onToggle,
  className = 'absolute bottom-4 left-4',
}: {
  on: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      onClick={onToggle}
      title="Toggle 3D terrain"
      className={`${className} flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all`}
      style={{
        zIndex: 10,
        background: on ? 'rgba(139,92,246,0.22)' : 'rgba(10,18,34,0.92)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${on ? 'rgba(139,92,246,0.55)' : 'rgba(148,163,184,0.18)'}`,
        color: on ? '#c4b5fd' : '#94a3b8',
      }}
    >
      <Mountain className="w-3.5 h-3.5" />
      3D
    </button>
  )
}
