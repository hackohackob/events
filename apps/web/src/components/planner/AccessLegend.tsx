'use client'

import { Loader2, TriangleAlert } from 'lucide-react'
import { TRACK_ACCESS_LEGEND } from '@/lib/track-access'

/**
 * The key to the access view.
 *
 * Always on screen while the view is: the colours are an ordered ladder, and a
 * ladder you have to remember is a ladder you read wrong. Ordered exactly as
 * the ramp is — everything gets there at the top, nothing does at the bottom —
 * so the legend itself shows the direction the colour is travelling.
 */
export default function AccessLegend({
  loading,
  failed,
  unmappedMeters,
}: {
  loading: boolean
  failed: boolean
  unmappedMeters: number | null
}) {
  return (
    <div
      className="absolute left-4 bottom-4 rounded-xl overflow-hidden no-print"
      style={{
        background: 'rgba(8,15,28,0.92)',
        border: '1px solid rgba(148,163,184,0.14)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(12px)',
        width: 186,
      }}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-2"
        style={{ borderBottom: '1px solid rgba(148,163,184,0.1)' }}
      >
        <span className="text-[10px] font-bold tracking-wide" style={{ color: '#cbd5e1' }}>
          WHAT CAN GET THERE
        </span>
        {loading && <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#60a5fa' }} />}
      </div>

      <div className="px-3 py-2 flex flex-col gap-1.5">
        {TRACK_ACCESS_LEGEND.map(entry => (
          <div key={entry.tier} className="flex items-center gap-2">
            <span
              className="rounded-full flex-shrink-0"
              style={{
                width: 16,
                height: 4,
                background: entry.color ?? 'rgba(148,163,184,0.55)',
                // The unmapped swatch is the neutral course line itself, so it
                // is drawn the same way: outlined rather than filled.
                border: entry.color ? undefined : '1px solid rgba(148,163,184,0.5)',
              }}
            />
            <span className="text-[10px] font-semibold" style={{ color: '#e2e8f0' }}>
              {entry.label}
            </span>
            <span className="text-[9px] ml-auto" style={{ color: '#64748b' }}>
              {entry.hint}
            </span>
          </div>
        ))}
      </div>

      {failed && (
        <div
          className="flex items-start gap-1.5 px-3 py-2 text-[9px] leading-tight"
          style={{ borderTop: '1px solid rgba(148,163,184,0.1)', color: '#fbbf24' }}
        >
          <TriangleAlert className="w-3 h-3 flex-shrink-0 mt-[1px]" />
          The routing engine could not read the ground. The course is drawn plain.
        </div>
      )}

      {!failed && unmappedMeters != null && unmappedMeters > 0 && (
        <div
          className="px-3 py-2 text-[9px] leading-tight"
          style={{ borderTop: '1px solid rgba(148,163,184,0.1)', color: '#64748b' }}
        >
          <strong style={{ color: '#94a3b8' }}>{(unmappedMeters / 1000).toFixed(1)} km</strong> of
          course has no mapped way at all — plan to carry.
        </div>
      )}
    </div>
  )
}
