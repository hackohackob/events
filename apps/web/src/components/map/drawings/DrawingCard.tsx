'use client'

import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Magnet, PenLine, Trash2, X } from 'lucide-react'
import type { EventDrawing, UpdateDrawingRequest } from '@events/contracts'
import { formatDistance } from '@/lib/drawing-geometry'
import { ColorSwatches, DashToggle, Switch } from './drawing-style'

interface Props {
  drawing: EventDrawing
  onUpdate: (patch: UpdateDrawingRequest) => void
  onDelete: () => void
  onClose: () => void
}

/**
 * The card that opens on a selected drawing: rename it, recolour it, leave a
 * note, decide whether the team sees it. Every change saves as it is made —
 * there is no Save button to forget.
 */
export default function DrawingCard({ drawing, onUpdate, onDelete, onClose }: Props) {
  const [name, setName] = useState(drawing.name)
  const [note, setNote] = useState(drawing.note ?? '')
  const nameRef = useRef<HTMLInputElement>(null)

  // Text is committed on blur/Enter, so re-seed only when another drawing opens.
  useEffect(() => {
    setName(drawing.name)
    setNote(drawing.note ?? '')
  }, [drawing.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const commitName = () => {
    const next = name.trim()
    if (next !== drawing.name) onUpdate({ name: next })
  }
  const commitNote = () => {
    const next = note.trim()
    if (next !== (drawing.note ?? '')) onUpdate({ note: next || null })
  }

  const strokes = drawing.lines.length

  return (
    <div style={{ width: 288 }}>
      {/* Accent strip in the drawing's own colour. */}
      <div style={{ height: 3, background: drawing.color }} />

      <div className="flex flex-col gap-3 p-3.5">
        <div className="flex items-start gap-2">
          <input
            ref={nameRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            maxLength={80}
            placeholder="Add a label…"
            className="drawing-input flex-1 min-w-0 text-sm font-bold"
            style={{ color: '#f1f5f9' }}
          />
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="p-1 rounded-md transition-colors hover:bg-white/10 flex-shrink-0"
            style={{ color: '#64748b' }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] -mt-1.5" style={{ color: '#94a3b8' }}>
          <span className="font-bold tabular-nums" style={{ color: '#e2e8f0' }}>{formatDistance(drawing.distanceMeters)}</span>
          <span style={{ color: '#475569' }}>·</span>
          {drawing.snapped
            ? <span className="flex items-center gap-1"><Magnet className="w-3 h-3" />follows roads</span>
            : <span className="flex items-center gap-1"><PenLine className="w-3 h-3" />freehand</span>}
          {strokes > 1 && (
            <>
              <span style={{ color: '#475569' }}>·</span>
              <span>{strokes} lines</span>
            </>
          )}
        </div>

        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          onBlur={commitNote}
          maxLength={400}
          rows={2}
          placeholder="Note for the team (optional)"
          className="drawing-input text-xs resize-none"
          style={{ color: '#cbd5e1', lineHeight: 1.45 }}
        />

        <div className="flex items-center justify-between">
          <ColorSwatches value={drawing.color} onChange={color => onUpdate({ color })} size={18} />
          <DashToggle dashed={drawing.dashed} color={drawing.color} onChange={dashed => onUpdate({ dashed })} />
        </div>

        <div
          className="flex items-center gap-2.5 pt-3"
          style={{ borderTop: '1px solid rgba(148,163,184,0.12)' }}
        >
          {drawing.visible
            ? <Eye className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#22c55e' }} />
            : <EyeOff className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#64748b' }} />}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold" style={{ color: '#e2e8f0' }}>
              {drawing.visible ? 'Shown on team maps' : 'Hidden from the team'}
            </div>
            <div className="text-[10px]" style={{ color: '#64748b' }}>
              {drawing.visible ? 'Medics see it in the app' : 'Only visible here'}
            </div>
          </div>
          <Switch on={drawing.visible} onChange={visible => onUpdate({ visible })} label="Show on team maps" />
          <button
            type="button"
            onClick={onDelete}
            title="Delete drawing"
            className="p-1.5 rounded-lg transition-colors hover:bg-red-500/15"
            style={{ color: '#f87171' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
