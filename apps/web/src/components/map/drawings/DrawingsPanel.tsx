'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Eye, EyeOff, PenLine, Trash2 } from 'lucide-react'
import type { EventDrawing } from '@events/contracts'
import { formatDistance } from '@/lib/drawing-geometry'
import { LineSwatch } from './drawing-style'

interface Props {
  drawings: EventDrawing[]
  selectedId: string | null
  /** The tool is open — the list steps back while a drawing is being made. */
  drawing: boolean
  onDraw: () => void
  /** Select + frame on the map. */
  onOpen: (drawing: EventDrawing) => void
  onToggleVisible: (drawing: EventDrawing) => void
  onDelete: (drawing: EventDrawing) => void
}

/**
 * Drawings section of the Layers panel — the same collapsible block as Tracks
 * and Zones. One row per drawing: click to find it on the map, the eye decides
 * whether the team sees it.
 */
export default function DrawingsPanel({ drawings, selectedId, drawing, onDraw, onOpen, onToggleVisible, onDelete }: Props) {
  const [open, setOpen] = useState(false)

  // A drawing picked on the map should be findable in the list too.
  useEffect(() => {
    if (selectedId) setOpen(true)
  }, [selectedId])

  const shown = drawings.filter(d => d.visible).length

  return (
    <div className="flex flex-col gap-1.5" style={{ borderTop: '1px solid rgba(148,163,184,0.1)', marginTop: 8, paddingTop: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full"
        style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#334155' }}>
          Drawings
        </span>
        <span className="flex items-center gap-1.5">
          {drawing && <span className="text-[9px] font-bold" style={{ color: '#f97316' }}>drawing…</span>}
          <span className="text-[10px] font-bold" style={{ color: '#475569' }}>
            {drawings.length === 0 ? 0 : `${shown}/${drawings.length}`}
          </span>
          <ChevronDown
            className="w-3.5 h-3.5 transition-transform"
            style={{ color: '#64748b', transform: open ? 'rotate(180deg)' : 'none' }}
          />
        </span>
      </button>

      {open && (
        <>
          {drawings.length === 0 && (
            // Width-capped: the Layers panel sizes to its content, and one
            // unwrapped sentence here stretched it across the map.
            <div className="text-[11px] px-1 leading-snug" style={{ color: '#475569', maxWidth: 176 }}>
              Nothing drawn yet. Sketch a way round a hard section, an arrow, a line not to cross.
            </div>
          )}

          {drawings.map(item => {
            const active = item.id === selectedId
            return (
              <div
                key={item.id}
                className="flex items-center gap-2 pl-2 pr-1.5 py-1.5 rounded-lg transition-colors"
                style={{
                  maxWidth: 236,
                  background: active ? `${item.color}24` : item.visible ? `${item.color}12` : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${active ? item.color + '99' : item.visible ? item.color + '38' : 'rgba(148,163,184,0.08)'}`,
                }}
              >
                <button
                  onClick={() => onOpen(item)}
                  title="Show on the map"
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  <LineSwatch color={item.color} dashed={item.dashed} width={20} dim={!item.visible} />
                  <span className="flex-1 min-w-0">
                    <span
                      className="block text-xs font-medium truncate"
                      style={{ color: item.visible ? '#e2e8f0' : '#64748b', fontStyle: item.name ? 'normal' : 'italic' }}
                    >
                      {item.name || 'Untitled'}
                    </span>
                    <span className="block text-[9px] font-semibold tabular-nums" style={{ color: '#475569' }}>
                      {formatDistance(item.distanceMeters)}{item.snapped ? ' · roads' : ''}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => onToggleVisible(item)}
                  title={item.visible ? 'Shown on team maps — click to hide' : 'Hidden from the team — click to show'}
                  className="p-1 rounded-md transition-colors hover:bg-white/10"
                  style={{ color: item.visible ? '#22c55e' : '#475569' }}
                >
                  {item.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => onDelete(item)}
                  title="Delete drawing"
                  className="p-1 rounded-md transition-colors hover:bg-red-500/15"
                  style={{ color: '#64748b' }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}

          {!drawing && (
            <button
              onClick={onDraw}
              className="flex items-center justify-center gap-2 rounded-lg py-1.5 text-[11px] font-bold transition-all hover:brightness-125"
              style={{ background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.4)', color: '#fb923c' }}
            >
              <PenLine className="w-3 h-3" />
              New drawing
            </button>
          )}
        </>
      )}
    </div>
  )
}
