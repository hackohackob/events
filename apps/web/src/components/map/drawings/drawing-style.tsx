'use client'

/** Shared look of the drawing UI: palette, glass surface, and the small controls. */

export const DRAWING_COLORS = ['#f97316', '#facc15', '#f43f5e', '#22d3ee', '#a78bfa', '#34d399', '#f8fafc']
export const DEFAULT_DRAWING_COLOR = DRAWING_COLORS[0]

/** Frosted dark panel — the same surface the Layers panel and the scrubber sit on. */
export const GLASS: React.CSSProperties = {
  background: 'rgba(10,18,34,0.94)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(148,163,184,0.16)',
  boxShadow: '0 16px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
}

/** A short line sample in a drawing's colour and dash — the swatch used in lists. */
export function LineSwatch({ color, dashed, width = 22, dim = false }: { color: string; dashed: boolean; width?: number; dim?: boolean }) {
  return (
    <svg width={width} height={10} viewBox={`0 0 ${width} 10`} className="flex-shrink-0" style={{ opacity: dim ? 0.45 : 1 }} aria-hidden>
      <line x1={2} y1={5} x2={width - 2} y2={5} stroke="#0b1220" strokeWidth={6} strokeLinecap="round" />
      <line
        x1={2}
        y1={5}
        x2={width - 2}
        y2={5}
        stroke={color}
        strokeWidth={3}
        strokeLinecap={dashed ? 'butt' : 'round'}
        strokeDasharray={dashed ? '4 3' : undefined}
      />
    </svg>
  )
}

export function ColorSwatches({ value, onChange, size = 20 }: { value: string; onChange: (color: string) => void; size?: number }) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Colour">
      {DRAWING_COLORS.map(color => {
        const active = color.toLowerCase() === value.toLowerCase()
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={color}
            onClick={() => onChange(color)}
            className="rounded-full transition-transform hover:scale-110 focus-visible:outline-none"
            style={{
              width: size,
              height: size,
              background: color,
              boxShadow: active
                ? `0 0 0 2px rgba(10,18,34,1), 0 0 0 4px ${color}`
                : 'inset 0 0 0 1px rgba(0,0,0,0.25)',
            }}
          />
        )
      })}
    </div>
  )
}

/** Solid / dashed, as two little line samples. */
export function DashToggle({ dashed, color, onChange }: { dashed: boolean; color: string; onChange: (dashed: boolean) => void }) {
  return (
    <div className="flex rounded-lg p-0.5" style={{ background: 'rgba(2,8,20,0.6)', border: '1px solid rgba(148,163,184,0.12)' }}>
      {[false, true].map(option => {
        const active = dashed === option
        return (
          <button
            key={String(option)}
            type="button"
            onClick={() => onChange(option)}
            title={option ? 'Dashed line' : 'Solid line'}
            aria-pressed={active}
            className="flex items-center justify-center rounded-md transition-colors"
            style={{ width: 38, height: 24, background: active ? 'rgba(148,163,184,0.18)' : 'transparent' }}
          >
            <LineSwatch color={active ? color : '#64748b'} dashed={option} />
          </button>
        )
      })}
    </div>
  )
}

/** iOS-style switch. */
export function Switch({ on, onChange, color = '#22c55e', label }: { on: boolean; onChange: (on: boolean) => void; color?: string; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="relative flex-shrink-0 rounded-full transition-colors"
      style={{ width: 30, height: 18, background: on ? color : 'rgba(100,116,139,0.45)' }}
    >
      <span
        className="absolute top-[2px] rounded-full bg-white transition-all"
        style={{ width: 14, height: 14, left: on ? 14 : 2, boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }}
      />
    </button>
  )
}
