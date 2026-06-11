'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, BookOpen, Check, ChevronRight, Loader2, Plus, Search, Trash2, X,
} from 'lucide-react'
import {
  createFieldGuideCase, deleteFieldGuideCase, listFieldGuide, updateFieldGuideCase,
  type FieldGuideCase, type FieldGuideCaseInput,
} from '@/api/field-guide'

const CATEGORIES: Array<{ id: string; label: string; color: string }> = [
  { id: 'cardiac', label: 'Cardiac', color: '#f87171' },
  { id: 'neuro', label: 'Neuro', color: '#c084fc' },
  { id: 'metabolic', label: 'Metabolic', color: '#fbbf24' },
  { id: 'environmental', label: 'Environment', color: '#38bdf8' },
  { id: 'trauma', label: 'Trauma', color: '#fb923c' },
  { id: 'airway', label: 'Airway', color: '#34d399' },
  { id: 'allergy', label: 'Allergy', color: '#f472b6' },
  { id: 'other', label: 'Other', color: '#94a3b8' },
]

function categoryColor(id: string): string {
  return CATEGORIES.find(c => c.id === id)?.color ?? '#94a3b8'
}

interface DraftCase {
  title: string
  category: string
  keywords: string
  summary: string
  signs: string
  actions: string
  redFlags: string
}

const EMPTY_DRAFT: DraftCase = {
  title: '', category: 'other', keywords: '', summary: '', signs: '', actions: '', redFlags: '',
}

function toDraft(c: FieldGuideCase): DraftCase {
  return {
    title: c.title,
    category: c.category,
    keywords: c.keywords.join(', '),
    summary: c.summary,
    signs: c.signs.join('\n'),
    actions: c.actions.join('\n'),
    redFlags: c.redFlags.join('\n'),
  }
}

function fromDraft(d: DraftCase): FieldGuideCaseInput {
  const lines = (value: string) => value.split('\n').map(s => s.trim()).filter(Boolean)
  return {
    title: d.title.trim(),
    category: d.category,
    keywords: d.keywords.split(',').map(s => s.trim()).filter(Boolean),
    summary: d.summary.trim(),
    signs: lines(d.signs),
    actions: lines(d.actions),
    redFlags: lines(d.redFlags),
  }
}

export default function FieldGuidePage() {
  const queryClient = useQueryClient()
  const { data: cases = [], isLoading } = useQuery({ queryKey: ['field-guide'], queryFn: listFieldGuide })

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  // null = closed, 'new' = creating, otherwise the case id being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftCase>(EMPTY_DRAFT)

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['field-guide'] })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = fromDraft(draft)
      if (editing && editing !== 'new') return updateFieldGuideCase(editing, input)
      return createFieldGuideCase(input)
    },
    onSuccess: () => { invalidate(); setEditing(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteFieldGuideCase,
    onSuccess: () => { invalidate(); setEditing(null) },
  })

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return cases.filter(c => {
      if (category && c.category !== category) return false
      if (!q) return true
      const haystack = [c.title, c.summary, ...c.keywords, ...c.signs].join(' ').toLowerCase()
      return q.split(/\s+/).every(word => haystack.includes(word))
    })
  }, [cases, query, category])

  const openEditor = (target: FieldGuideCase | 'new') => {
    if (target === 'new') {
      setDraft(EMPTY_DRAFT)
      setEditing('new')
    } else {
      setDraft(toDraft(target))
      setEditing(target.id)
    }
  }

  const set = (key: keyof DraftCase) => (value: string) => setDraft(d => ({ ...d, [key]: value }))

  return (
    <div className="flex-1 px-6 lg:px-10 py-8 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)' }}>
            <BookOpen className="w-5 h-5" style={{ color: '#22c55e' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Field Guide</h1>
            <p className="text-xs" style={{ color: '#64748b' }}>
              Action reminders medics see in the app · {cases.length} cases
            </p>
          </div>
        </div>
        <button
          onClick={() => openEditor('new')}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
          style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}
        >
          <Plus className="w-4 h-4" /> New case
        </button>
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <div className="flex items-center gap-2 px-3.5 rounded-xl flex-1 min-w-[240px]"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.15)' }}>
          <Search className="w-4 h-4 flex-shrink-0" style={{ color: '#64748b' }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search title, symptoms, keywords…"
            className="bg-transparent outline-none text-sm py-2.5 w-full text-slate-200 placeholder:text-slate-600"
          />
          {query && (
            <button onClick={() => setQuery('')}><X className="w-4 h-4" style={{ color: '#64748b' }} /></button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {CATEGORIES.map(c => {
            const active = category === c.id
            return (
              <button
                key={c.id}
                onClick={() => setCategory(active ? null : c.id)}
                className="px-3 py-1.5 rounded-full text-xs font-bold transition-colors"
                style={active
                  ? { background: `${c.color}22`, color: c.color, border: `1px solid ${c.color}88` }
                  : { background: 'rgba(255,255,255,0.03)', color: '#64748b', border: '1px solid rgba(148,163,184,0.15)' }}
              >
                {c.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#22c55e' }} />
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
          {results.map(item => (
            <button
              key={item.id}
              onClick={() => openEditor(item)}
              className="text-left rounded-2xl p-4 transition-all hover:scale-[1.01] group"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.1)' }}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[10px] font-black tracking-widest px-2 py-0.5 rounded-full"
                  style={{ background: `${categoryColor(item.category)}1c`, color: categoryColor(item.category) }}>
                  {item.category.toUpperCase()}
                </span>
                <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#64748b' }} />
              </div>
              <div className="text-sm font-bold text-slate-100">{item.title}</div>
              <div className="text-xs mt-1 line-clamp-2" style={{ color: '#7d8ea4' }}>{item.summary}</div>
              <div className="flex items-center gap-3 mt-3 text-[11px] font-semibold" style={{ color: '#475569' }}>
                <span>{item.actions.length} steps</span>
                <span>{item.signs.length} signs</span>
                {item.redFlags.length > 0 && (
                  <span className="flex items-center gap-1" style={{ color: '#f87171' }}>
                    <AlertTriangle className="w-3 h-3" /> {item.redFlags.length}
                  </span>
                )}
              </div>
            </button>
          ))}
          {results.length === 0 && (
            <div className="col-span-full text-center text-sm py-16" style={{ color: '#475569' }}>
              No cases match your search.
            </div>
          )}
        </div>
      )}

      {/* Editor drawer */}
      {editing !== null && (
        <div className="fixed inset-0" style={{ zIndex: 70 }}>
          <div className="absolute inset-0" style={{ background: 'rgba(5,10,20,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={() => setEditing(null)} />
          <div className="absolute top-0 right-0 h-full flex flex-col overflow-y-auto"
            style={{ width: 520, maxWidth: '95vw', background: 'rgba(8,15,28,0.99)', borderLeft: '1px solid rgba(148,163,184,0.12)', boxShadow: '-24px 0 80px rgba(0,0,0,0.6)' }}>
            <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
              <div className="text-base font-bold text-slate-100">
                {editing === 'new' ? 'New field guide case' : 'Edit case'}
              </div>
              <button onClick={() => setEditing(null)} className="p-2 rounded-xl" style={{ color: '#64748b', background: 'rgba(255,255,255,0.04)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 px-6 py-5 space-y-4">
              <Field label="Title" value={draft.title} onChange={set('title')} placeholder="Heat stroke" />
              <div>
                <FieldLabel>Category</FieldLabel>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {CATEGORIES.map(c => {
                    const active = draft.category === c.id
                    return (
                      <button key={c.id} onClick={() => set('category')(c.id)}
                        className="px-3 py-1.5 rounded-full text-xs font-bold transition-colors"
                        style={active
                          ? { background: `${c.color}22`, color: c.color, border: `1px solid ${c.color}88` }
                          : { background: 'rgba(255,255,255,0.03)', color: '#64748b', border: '1px solid rgba(148,163,184,0.15)' }}>
                        {c.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <Field label="Summary (one line shown in results)" value={draft.summary} onChange={set('summary')}
                placeholder="Hot + confused athlete = emergency. Cool first, transport second." />
              <Field label="Search keywords (comma separated)" value={draft.keywords} onChange={set('keywords')}
                placeholder="hot, collapse, confusion, hyperthermia" />
              <Area label="Recognize — one sign per line" value={draft.signs} onChange={set('signs')} rows={4} />
              <Area label="Do — one action step per line (shown numbered)" value={draft.actions} onChange={set('actions')} rows={5} />
              <Area label="Red flags — one per line" value={draft.redFlags} onChange={set('redFlags')} rows={3} />
            </div>

            <div className="flex items-center gap-2 px-6 py-5" style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !draft.title.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {editing === 'new' ? 'Create case' : 'Save changes'}
              </button>
              {editing !== 'new' && (
                <button
                  onClick={() => { if (confirm('Delete this case for all medics?')) deleteMutation.mutate(editing) }}
                  disabled={deleteMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
                  style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-black tracking-widest mb-1.5" style={{ color: '#64748b' }}>{children}</div>
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(148,163,184,0.15)',
  color: '#e2e8f0',
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div>
      <FieldLabel>{label.toUpperCase()}</FieldLabel>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none placeholder:text-slate-600" style={inputStyle} />
    </div>
  )
}

function Area({ label, value, onChange, rows }: {
  label: string; value: string; onChange: (v: string) => void; rows: number
}) {
  return (
    <div>
      <FieldLabel>{label.toUpperCase()}</FieldLabel>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows}
        className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none resize-y placeholder:text-slate-600" style={inputStyle} />
    </div>
  )
}
