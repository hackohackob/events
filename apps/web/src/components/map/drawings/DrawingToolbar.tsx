'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft, Car, Check, Eye, EyeOff, Footprints, Loader2, Magnet, PenLine, Redo2, Trash2, Truck, Undo2, Waypoints, X,
} from 'lucide-react'
import type { SnapProfile } from '@events/contracts'
import type { DrawingDraft, DrawingTool } from '@/hooks/useDrawingDraft'
import { formatDistance } from '@/lib/drawing-geometry'
import { ColorSwatches, DashToggle, GLASS, Switch } from './drawing-style'

const ACCENT = '#f97316'

const TOOLS: Array<{ id: DrawingTool; label: string; hint: string; Icon: typeof PenLine; key: string }> = [
  { id: 'freehand', label: 'Freehand', hint: 'Press and drag to draw', Icon: PenLine, key: 'F' },
  { id: 'points', label: 'Points', hint: 'Click point by point', Icon: Waypoints, key: 'P' },
]

const PROFILES: Array<{ id: SnapProfile; label: string; Icon: typeof Car }> = [
  { id: 'foot', label: 'Any path — trails, tracks and roads', Icon: Footprints },
  { id: 'rescue_4x4', label: '4×4 — dirt tracks and roads', Icon: Truck },
  { id: 'car', label: 'Car — roads only', Icon: Car },
]

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center justify-center rounded px-1 text-[9px] font-bold"
      style={{ minWidth: 16, height: 16, background: 'rgba(148,163,184,0.14)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.18)', fontFamily: 'inherit' }}
    >
      {children}
    </kbd>
  )
}

function IconButton({ onClick, disabled, title, children }: { onClick: () => void; disabled?: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="flex items-center justify-center rounded-lg transition-colors enabled:hover:bg-white/10 disabled:opacity-30"
      style={{ width: 30, height: 30, color: '#cbd5e1' }}
    >
      {children}
    </button>
  )
}

const Divider = () => <span className="w-px self-stretch my-1.5" style={{ background: 'rgba(148,163,184,0.14)' }} />

export interface DrawingSaveInput {
  name: string
  note: string
  visible: boolean
}

interface Props {
  draft: DrawingDraft
  /** Colour/dash for the drawing being made — lifted so the map previews it. */
  style: { color: string; dashed: boolean }
  onStyleChange: (style: { color: string; dashed: boolean }) => void
  onSave: (input: DrawingSaveInput) => Promise<void>
}

/**
 * Everything the drawing tool shows over the map: the "Draw" button that opens
 * it, the toolbar while drawing, and the card that names and saves the result.
 */
export default function DrawingToolbar({ draft, style, onStyleChange, onSave }: Props) {
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  // Newest draft for the key handler, which is registered once.
  const draftRef = useRef(draft)
  draftRef.current = draft
  const confirmRef = useRef(confirmDiscard)
  confirmRef.current = confirmDiscard

  useEffect(() => {
    if (draft.phase !== 'drawing') setConfirmDiscard(false)
  }, [draft.phase])

  // A notice says its piece and leaves.
  useEffect(() => {
    if (!draft.notice) return
    const timer = setTimeout(draft.dismissNotice, 4500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.notice?.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = draftRef.current
      if (isTyping(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      if (d.phase === 'idle') {
        if (!mod && !e.altKey && e.key.toLowerCase() === 'd') {
          e.preventDefault()
          d.begin()
        }
        return
      }
      if (d.phase !== 'drawing') return
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) d.redo()
        else d.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        d.redo()
        return
      }
      if (mod || e.altKey) return
      switch (e.key) {
        case 'Enter':
          e.preventDefault()
          if (d.lines.length > 0 && !d.pending) d.finish()
          break
        case 'Escape':
          e.preventDefault()
          if (confirmRef.current) setConfirmDiscard(false)
          else if (d.isEmpty) d.reset()
          else setConfirmDiscard(true)
          break
        case 'Backspace':
        case 'Delete':
          e.preventDefault()
          d.undo()
          break
        case 'f':
        case 'F':
          d.setTool('freehand')
          break
        case 'p':
        case 'P':
          d.setTool('points')
          break
        case 's':
        case 'S':
          d.setSnap(!d.snap)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const cancel = () => {
    if (draft.isEmpty) draft.reset()
    else setConfirmDiscard(true)
  }

  const canFinish = draft.lines.length > 0 && !draft.pending

  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none"
      style={{ top: 16, zIndex: 20, maxWidth: 'calc(100% - 24px)' }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {draft.phase === 'idle' && (
          <motion.button
            key="launcher"
            type="button"
            onClick={draft.begin}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16 }}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            title="Draw on the map (D)"
            className="pointer-events-auto flex items-center gap-2 pl-3 pr-2.5 rounded-full text-xs font-bold"
            style={{ ...GLASS, height: 36, color: '#e2e8f0' }}
          >
            <PenLine className="w-3.5 h-3.5" style={{ color: ACCENT }} />
            Draw
            <Kbd>D</Kbd>
          </motion.button>
        )}

        {draft.phase === 'drawing' && (
          <motion.div
            key="toolbar"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="pointer-events-auto flex flex-col items-center gap-2"
          >
            <div className="flex items-center gap-1.5 p-1.5 rounded-2xl" style={GLASS} role="toolbar" aria-label="Drawing tools">
              {/* Tool */}
              <div className="flex rounded-xl p-0.5" style={{ background: 'rgba(2,8,20,0.55)' }}>
                {TOOLS.map(({ id, label, hint, Icon, key }) => {
                  const active = draft.tool === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => draft.setTool(id)}
                      aria-pressed={active}
                      title={`${label} — ${hint} (${key})`}
                      className="relative flex items-center gap-1.5 px-2.5 rounded-[10px] text-xs font-bold transition-colors"
                      style={{ height: 30, color: active ? '#fff' : '#94a3b8' }}
                    >
                      {active && (
                        <motion.span
                          layoutId="drawing-tool-pill"
                          className="absolute inset-0 rounded-[10px]"
                          style={{ background: 'rgba(249,115,22,0.22)', boxShadow: 'inset 0 0 0 1px rgba(249,115,22,0.55)' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                        />
                      )}
                      <Icon className="relative w-3.5 h-3.5" style={{ color: active ? ACCENT : undefined }} />
                      <span className="relative hidden md:inline">{label}</span>
                    </button>
                  )
                })}
              </div>

              <Divider />

              {/* Snap */}
              <button
                type="button"
                onClick={() => draft.setSnap(!draft.snap)}
                aria-pressed={draft.snap}
                title={draft.snap
                  ? 'Following roads — new lines are pulled onto the nearest road or path (S)'
                  : 'Free drawing — new lines stay where you draw them, lightly smoothed (S)'}
                className="flex items-center gap-2 pl-2.5 pr-2 rounded-xl text-xs font-bold transition-colors"
                style={{
                  height: 34,
                  color: draft.snap ? '#e2e8f0' : '#94a3b8',
                  background: draft.snap ? 'rgba(56,189,248,0.14)' : 'transparent',
                  boxShadow: draft.snap ? 'inset 0 0 0 1px rgba(56,189,248,0.4)' : 'none',
                }}
              >
                <Magnet className="w-3.5 h-3.5" style={{ color: draft.snap ? '#38bdf8' : undefined }} />
                <span className="hidden sm:inline whitespace-nowrap">Follow roads</span>
                <span
                  className="relative rounded-full transition-colors"
                  style={{ width: 26, height: 16, background: draft.snap ? '#38bdf8' : 'rgba(100,116,139,0.45)' }}
                >
                  <span
                    className="absolute top-[2px] rounded-full bg-white transition-all"
                    style={{ width: 12, height: 12, left: draft.snap ? 12 : 2 }}
                  />
                </span>
              </button>
              <AnimatePresence initial={false}>
                {draft.snap && (
                  <motion.div
                    key="profiles"
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 'auto', opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="flex overflow-hidden"
                  >
                    <div className="flex rounded-xl p-0.5" style={{ background: 'rgba(2,8,20,0.55)' }}>
                      {PROFILES.map(({ id, label, Icon }) => {
                        const active = draft.profile === id
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => draft.setProfile(id)}
                            aria-pressed={active}
                            title={label}
                            className="flex items-center justify-center rounded-[10px] transition-colors"
                            style={{
                              width: 30,
                              height: 30,
                              color: active ? '#38bdf8' : '#64748b',
                              background: active ? 'rgba(56,189,248,0.16)' : 'transparent',
                            }}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </button>
                        )
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <Divider />

              <IconButton onClick={draft.undo} disabled={!draft.canUndo} title="Undo (⌘Z)"><Undo2 className="w-4 h-4" /></IconButton>
              <IconButton onClick={draft.redo} disabled={!draft.canRedo} title="Redo (⇧⌘Z)"><Redo2 className="w-4 h-4" /></IconButton>

              <Divider />

              {/* Live length */}
              <div className="flex flex-col items-end justify-center px-1.5" style={{ minWidth: 62 }}>
                <span className="text-xs font-black tabular-nums leading-none" style={{ color: draft.distanceMeters > 0 ? '#f1f5f9' : '#475569' }}>
                  {formatDistance(draft.distanceMeters)}
                </span>
                <span className="text-[9px] font-semibold leading-none mt-1" style={{ color: '#64748b' }}>
                  {draft.lines.length === 0 ? 'no lines yet' : draft.lines.length === 1 ? '1 line' : `${draft.lines.length} lines`}
                </span>
              </div>

              <button
                type="button"
                onClick={cancel}
                title="Cancel (Esc)"
                className="px-2.5 rounded-xl text-xs font-bold transition-colors hover:bg-white/10"
                style={{ height: 34, color: '#94a3b8' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={draft.finish}
                disabled={!canFinish}
                title="Finish and name this drawing (Enter)"
                className="flex items-center gap-1.5 pl-3 pr-2.5 rounded-xl text-xs font-black transition-all enabled:hover:brightness-110 disabled:opacity-35"
                style={{ height: 34, background: ACCENT, color: '#1a0e03' }}
              >
                {draft.pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                Done
              </button>
            </div>

            {/* One line of guidance — or the discard question, or a notice. */}
            <AnimatePresence mode="wait" initial={false}>
              {confirmDiscard ? (
                <motion.div
                  key="discard"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.14 }}
                  className="flex items-center gap-2 pl-3 pr-1.5 rounded-full text-xs"
                  style={{ ...GLASS, height: 34, borderColor: 'rgba(248,113,113,0.4)' }}
                >
                  <span className="font-semibold" style={{ color: '#fecaca' }}>Discard this drawing?</span>
                  <button
                    type="button"
                    onClick={() => setConfirmDiscard(false)}
                    className="px-2.5 rounded-full font-bold transition-colors hover:bg-white/10"
                    style={{ height: 24, color: '#cbd5e1' }}
                  >
                    Keep drawing
                  </button>
                  <button
                    type="button"
                    onClick={draft.reset}
                    className="flex items-center gap-1 px-2.5 rounded-full font-bold"
                    style={{ height: 24, background: 'rgba(239,68,68,0.22)', color: '#fca5a5' }}
                  >
                    <Trash2 className="w-3 h-3" /> Discard
                  </button>
                </motion.div>
              ) : draft.notice ? (
                <motion.div
                  key={`notice-${draft.notice.id}`}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.14 }}
                  className="flex items-center gap-2 px-3 rounded-full text-xs font-semibold"
                  style={{ ...GLASS, height: 30, borderColor: 'rgba(251,191,36,0.4)', color: '#fde68a' }}
                >
                  <Magnet className="w-3 h-3" />
                  {draft.notice.text}
                </motion.div>
              ) : (
                <motion.div
                  key={`hint-${draft.tool}-${draft.pending}`}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.14 }}
                  className="flex items-center gap-2 px-3 rounded-full text-[11px] font-medium whitespace-nowrap"
                  style={{ ...GLASS, height: 28, color: '#94a3b8' }}
                >
                  {draft.pending ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#38bdf8' }} />
                      <span style={{ color: '#bae6fd' }}>Matching to the road…</span>
                    </>
                  ) : draft.tool === 'freehand' ? (
                    <>
                      <span>Drag to draw — each stroke is its own line</span>
                      <span style={{ color: '#475569' }}>·</span>
                      <span className="flex items-center gap-1">hold <Kbd>Space</Kbd> to pan</span>
                    </>
                  ) : (
                    <>
                      <span>Click to add points</span>
                      <span style={{ color: '#475569' }}>·</span>
                      <span>double-click to end a line</span>
                    </>
                  )}
                  <span style={{ color: '#475569' }}>·</span>
                  <span className="flex items-center gap-1"><Kbd>⏎</Kbd> done</span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {draft.phase === 'details' && (
          <SaveCard key="details" draft={draft} style={style} onStyleChange={onStyleChange} onSave={onSave} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Name it and save ────────────────────────────────────────────────────────

function SaveCard({ draft, style, onStyleChange, onSave }: Props) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [visible, setVisible] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave({ name: name.trim(), note: note.trim(), visible })
    } catch {
      setError('Couldn’t save — check the connection and try again')
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        draft.resume()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft])

  return (
    <motion.form
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      onSubmit={e => {
        e.preventDefault()
        void save()
      }}
      className="pointer-events-auto flex flex-col gap-3 p-4 rounded-2xl"
      style={{ ...GLASS, width: 340, maxWidth: '100%' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-black" style={{ color: '#f1f5f9' }}>Save drawing</span>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tabular-nums" style={{ color: '#94a3b8' }}>
          {draft.snappedAny && <Magnet className="w-3 h-3" style={{ color: '#38bdf8' }} />}
          {formatDistance(draft.distanceMeters)}
          {draft.lines.length > 1 && <span>· {draft.lines.length} lines</span>}
        </span>
      </div>

      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        maxLength={80}
        placeholder="Label — e.g. “Bypass of the rock step”"
        className="drawing-input text-sm font-semibold"
        style={{ color: '#f1f5f9' }}
      />
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        maxLength={400}
        rows={2}
        placeholder="Note for the team (optional)"
        className="drawing-input text-xs resize-none"
        style={{ color: '#cbd5e1', lineHeight: 1.45 }}
      />

      <div className="flex items-center justify-between">
        <ColorSwatches value={style.color} onChange={color => onStyleChange({ ...style, color })} />
        <DashToggle dashed={style.dashed} color={style.color} onChange={dashed => onStyleChange({ ...style, dashed })} />
      </div>

      <label
        className="flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer"
        style={{ background: 'rgba(2,8,20,0.45)', border: '1px solid rgba(148,163,184,0.1)' }}
      >
        {visible
          ? <Eye className="w-4 h-4 flex-shrink-0" style={{ color: '#22c55e' }} />
          : <EyeOff className="w-4 h-4 flex-shrink-0" style={{ color: '#64748b' }} />}
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-semibold" style={{ color: '#e2e8f0' }}>Show on team maps</span>
          <span className="block text-[10px]" style={{ color: '#64748b' }}>
            {visible ? 'Medics see it in the app right away' : 'Kept here as a draft'}
          </span>
        </span>
        <Switch on={visible} onChange={setVisible} label="Show on team maps" />
      </label>

      {error && <div className="text-[11px] font-semibold" style={{ color: '#fca5a5' }}>{error}</div>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={draft.resume}
          className="flex items-center gap-1.5 px-3 rounded-xl text-xs font-bold transition-colors hover:bg-white/10"
          style={{ height: 36, color: '#94a3b8' }}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Keep drawing
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl text-xs font-black transition-all enabled:hover:brightness-110 disabled:opacity-60"
          style={{ height: 36, background: ACCENT, color: '#1a0e03' }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" strokeWidth={3} />}
          Save drawing
        </button>
      </div>
    </motion.form>
  )
}
