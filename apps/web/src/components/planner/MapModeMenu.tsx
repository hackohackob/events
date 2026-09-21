'use client'

import { useEffect, useRef, useState } from 'react'
import { CarFront, ChevronDown, Layers, ShieldAlert } from 'lucide-react'

/**
 * What the course colour means right now.
 *
 * One meaning at a time, chosen from a menu rather than stacked as toggles: the
 * three readings all paint the same line, and two of them at once is how the
 * old view became unreadable. The menu also has room to say what each one is
 * for, which three icon buttons never did.
 */
export type PlannerMapMode = 'field' | 'gaps' | 'access'

interface ModeMeta {
  label: string
  hint: string
  color: string
  Icon: typeof Layers
}

export const MAP_MODES: Record<PlannerMapMode, ModeMeta> = {
  field: {
    label: 'Field',
    hint: 'Where the runners are, minute by minute',
    color: '#fbbf24',
    Icon: Layers,
  },
  gaps: {
    label: 'Gaps',
    hint: 'Occupied course with nobody in reach',
    color: '#f87171',
    Icon: ShieldAlert,
  },
  access: {
    label: 'Access',
    hint: 'What can drive onto each stretch',
    color: '#60a5fa',
    Icon: CarFront,
  },
}

const ORDER: PlannerMapMode[] = ['field', 'gaps', 'access']

export default function MapModeMenu({
  mode,
  onMode,
}: {
  mode: PlannerMapMode
  onMode: (mode: PlannerMapMode) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const current = MAP_MODES[mode]

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative no-print">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors"
        style={{
          background: `${current.color}1f`,
          border: `1px solid ${current.color}4d`,
          color: current.color,
        }}
        title={current.hint}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <current.Icon className="w-3 h-3" />
        {current.label}
        <ChevronDown
          className="w-3 h-3 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : undefined, opacity: 0.7 }}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1.5 w-60 rounded-xl overflow-hidden z-30"
          style={{
            background: 'rgba(8,15,28,0.97)',
            border: '1px solid rgba(148,163,184,0.14)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
            backdropFilter: 'blur(12px)',
            animation: 'plannerHintIn 160ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {ORDER.map(key => {
            const meta = MAP_MODES[key]
            const active = key === mode
            return (
              <button
                key={key}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onMode(key)
                  setOpen(false)
                }}
                className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors"
                style={{
                  background: active ? `${meta.color}14` : 'transparent',
                  borderLeft: `2px solid ${active ? meta.color : 'transparent'}`,
                }}
              >
                <meta.Icon
                  className="w-3.5 h-3.5 mt-[1px] flex-shrink-0"
                  style={{ color: active ? meta.color : '#64748b' }}
                />
                <span className="min-w-0">
                  <span
                    className="block text-[11px] font-bold"
                    style={{ color: active ? meta.color : '#cbd5e1' }}
                  >
                    {meta.label}
                  </span>
                  <span className="block text-[10px] leading-tight mt-0.5" style={{ color: '#64748b' }}>
                    {meta.hint}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
