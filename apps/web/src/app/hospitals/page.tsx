'use client'

import { useMemo, useState } from 'react'
import { Search, Plus, X, Phone, Clock, MapPin, Pencil, Trash2, Loader2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchHospitals, createHospital, updateHospital, deleteHospital } from '@/api/hospitals'
import type { Hospital, HospitalCapability, HospitalHoursRule, UpsertHospitalRequest } from '@events/contracts'
import { HOSPITAL_CAPABILITIES } from '@events/contracts'

const CAPABILITY_LABELS: Record<HospitalCapability, string> = {
  er: 'ER', trauma: 'Trauma', icu: 'ICU', ct: 'CT', mri: 'MRI', xray: 'X-ray',
  cardiology: 'Cardiology', pediatric: 'Pediatric', burn: 'Burn',
  neurology: 'Neurology', orthopedics: 'Orthopedics', surgery: 'Surgery',
}

/** Diagnostics highlighted in the table get warmer colors. */
const CAPABILITY_COLORS: Partial<Record<HospitalCapability, string>> = {
  er: '#f87171', trauma: '#fb923c', icu: '#f59e0b', ct: '#38bdf8', mri: '#818cf8', xray: '#a78bfa',
}

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

interface HospitalFormState {
  name: string
  nameBg: string
  address: string
  city: string
  lat: string
  lng: string
  phones: string
  emergency24h: boolean
  capabilities: HospitalCapability[]
  hours: HospitalHoursRule[]
  notes: string
}

const EMPTY_FORM: HospitalFormState = {
  name: '', nameBg: '', address: '', city: '', lat: '', lng: '',
  phones: '', emergency24h: false, capabilities: [], hours: [], notes: '',
}

function toForm(h: Hospital): HospitalFormState {
  return {
    name: h.name,
    nameBg: h.nameBg ?? '',
    address: h.address ?? '',
    city: h.city ?? '',
    lat: String(h.lat),
    lng: String(h.lng),
    phones: h.phones.join(', '),
    emergency24h: h.emergency24h,
    capabilities: [...h.capabilities],
    hours: (h.hours ?? []).map(r => ({ ...r, days: [...r.days] })),
    notes: h.notes ?? '',
  }
}

function toPayload(form: HospitalFormState): UpsertHospitalRequest {
  return {
    name: form.name.trim(),
    nameBg: form.nameBg.trim() || undefined,
    address: form.address.trim() || undefined,
    city: form.city.trim() || undefined,
    lat: Number(form.lat),
    lng: Number(form.lng),
    phones: form.phones.split(/[,;\n]/).map(p => p.trim()).filter(Boolean),
    emergency24h: form.emergency24h,
    capabilities: form.capabilities,
    hours: form.hours.length > 0 ? form.hours.filter(r => r.days.length > 0) : undefined,
    notes: form.notes.trim() || undefined,
  }
}

export default function HospitalsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [capFilter, setCapFilter] = useState<HospitalCapability | 'all'>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Hospital | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Hospital | null>(null)

  const { data: hospitals = [], isLoading } = useQuery({
    queryKey: ['hospitals'],
    queryFn: () => fetchHospitals(),
    staleTime: 30_000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['hospitals'] })
  const createMutation = useMutation({ mutationFn: createHospital, onSuccess: invalidate })
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpsertHospitalRequest }) => updateHospital(id, payload),
    onSuccess: invalidate,
  })
  const deleteMutation = useMutation({ mutationFn: deleteHospital, onSuccess: invalidate })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return hospitals.filter(h => {
      const matchSearch = !q
        || h.name.toLowerCase().includes(q)
        || h.nameBg?.toLowerCase().includes(q)
        || h.city?.toLowerCase().includes(q)
      const matchCap = capFilter === 'all' || h.capabilities.includes(capFilter)
      return matchSearch && matchCap
    })
  }, [hospitals, search, capFilter])

  const saving = createMutation.isPending || updateMutation.isPending

  const handleSave = async (form: HospitalFormState) => {
    const payload = toPayload(form)
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, payload })
    } else {
      await createMutation.mutateAsync(payload)
    }
    setModalOpen(false)
    setEditing(null)
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Header */}
      <div
        className="flex items-center justify-between px-8 py-5"
        style={{ borderBottom: '1px solid rgba(148,163,184,0.08)', background: 'rgba(12,21,39,0.6)', backdropFilter: 'blur(12px)' }}
      >
        <div>
          <h1 className="text-xl font-bold text-slate-100">Hospitals</h1>
          <p className="text-sm mt-0.5" style={{ color: '#64748b' }}>
            {hospitals.length} facilities · {hospitals.filter(h => h.emergency24h).length} with 24/7 emergency care
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true) }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-95"
          style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', boxShadow: '0 4px 14px rgba(34,197,94,0.35)' }}
        >
          <Plus className="w-4 h-4" />
          Add Hospital
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-8 py-4 flex-wrap" style={{ borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
        <div className="relative flex-1 max-w-xs min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#64748b' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or city…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-slate-200 outline-none transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)' }}
            onFocus={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.4)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)')}
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterChip label="All" active={capFilter === 'all'} onClick={() => setCapFilter('all')} />
          {HOSPITAL_CAPABILITIES.map(c => (
            <FilterChip key={c} label={CAPABILITY_LABELS[c]} active={capFilter === c} onClick={() => setCapFilter(c)} />
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-8 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-sm" style={{ color: '#64748b' }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Loading hospitals…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-sm" style={{ color: '#64748b' }}>
            {search || capFilter !== 'all' ? 'No hospitals match the current filters.' : 'No hospitals yet — add the first one.'}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(h => (
              <div
                key={h.id}
                className="flex items-start gap-4 rounded-2xl px-4 py-3.5 transition-colors group"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.08)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-100">{h.name}</span>
                    {h.emergency24h && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ color: '#22c55e', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)' }}>
                        24/7
                      </span>
                    )}
                    {h.source === 'osm' && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ color: '#64748b', background: 'rgba(100,116,139,0.1)' }}>
                        OSM
                      </span>
                    )}
                  </div>
                  {h.nameBg && h.nameBg !== h.name && (
                    <div className="text-xs mt-0.5" style={{ color: '#7d8ea4' }}>{h.nameBg}</div>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-xs flex-wrap" style={{ color: '#64748b' }}>
                    {(h.city || h.address) && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {[h.address, h.city].filter(Boolean).join(', ')}
                      </span>
                    )}
                    {h.phones.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {h.phones.join(' · ')}
                      </span>
                    )}
                    {h.hoursText && !h.emergency24h && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {h.hoursText}
                      </span>
                    )}
                  </div>
                  {h.capabilities.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {h.capabilities.map(c => {
                        const color = CAPABILITY_COLORS[c] ?? '#9fb3cc'
                        return (
                          <span key={c} className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                            style={{ color, background: `${color}1f`, border: `1px solid ${color}40` }}>
                            {CAPABILITY_LABELS[c]}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => { setEditing(h); setModalOpen(true) }}
                    className="p-2 rounded-lg transition-colors hover:bg-white/10"
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(h)}
                    className="p-2 rounded-lg transition-colors hover:bg-white/10"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" style={{ color: '#f87171' }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <HospitalModal
          editing={editing}
          saving={saving}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditing(null) }}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setConfirmDelete(null) }}>
          <div className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: '#0a1424', border: '1px solid rgba(148,163,184,0.12)' }}>
            <h2 className="text-base font-bold text-slate-100 mb-2">Delete hospital?</h2>
            <p className="text-sm mb-5" style={{ color: '#94a3b8' }}>
              “{confirmDelete.name}” will be removed from the directory for all apps.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { deleteMutation.mutate(confirmDelete.id); setConfirmDelete(null) }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
              >
                Delete
              </button>
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all"
      style={{
        color: active ? '#04121f' : '#94a3b8',
        background: active ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${active ? 'transparent' : 'rgba(148,163,184,0.12)'}`,
      }}
    >
      {label}
    </button>
  )
}

function HospitalModal({
  editing,
  saving,
  onSave,
  onClose,
}: {
  editing: Hospital | null
  saving: boolean
  onSave: (form: HospitalFormState) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<HospitalFormState>(editing ? toForm(editing) : EMPTY_FORM)
  const set = (patch: Partial<HospitalFormState>) => setForm(f => ({ ...f, ...patch }))

  const latNum = Number(form.lat)
  const lngNum = Number(form.lng)
  const valid = form.name.trim().length > 0 && Number.isFinite(latNum) && Number.isFinite(lngNum)
    && form.lat.trim() !== '' && form.lng.trim() !== ''

  const labelClass = 'block text-xs font-semibold text-slate-400 mb-1.5'
  const inputClass = 'w-full px-3 py-2 rounded-xl text-sm text-slate-100 outline-none transition-all'
  const inputStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)' }

  const toggleCapability = (c: HospitalCapability) =>
    set({
      capabilities: form.capabilities.includes(c)
        ? form.capabilities.filter(x => x !== c)
        : [...form.capabilities, c],
    })

  const updateRule = (i: number, patch: Partial<HospitalHoursRule>) =>
    set({ hours: form.hours.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) })

  const toggleRuleDay = (i: number, day: number) => {
    const rule = form.hours[i]
    updateRule(i, { days: rule.days.includes(day) ? rule.days.filter(d => d !== day) : [...rule.days, day].sort() })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-lg rounded-2xl p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        style={{ background: '#0a1424', border: '1px solid rgba(148,163,184,0.12)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-100">{editing ? 'Edit Hospital' : 'Add Hospital'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={labelClass}>Name <span style={{ color: '#ef4444' }}>*</span></label>
            <input value={form.name} onChange={e => set({ name: e.target.value })} className={inputClass} style={inputStyle} placeholder="УМБАЛСМ Н. И. Пирогов" />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Bulgarian name</label>
            <input value={form.nameBg} onChange={e => set({ nameBg: e.target.value })} className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className={labelClass}>Address</label>
            <input value={form.address} onChange={e => set({ address: e.target.value })} className={inputClass} style={inputStyle} placeholder="бул. Тотлебен 21" />
          </div>
          <div>
            <label className={labelClass}>City</label>
            <input value={form.city} onChange={e => set({ city: e.target.value })} className={inputClass} style={inputStyle} placeholder="София" />
          </div>
          <div>
            <label className={labelClass}>Latitude <span style={{ color: '#ef4444' }}>*</span></label>
            <input value={form.lat} onChange={e => set({ lat: e.target.value })} className={inputClass} style={inputStyle} placeholder="42.6903" />
          </div>
          <div>
            <label className={labelClass}>Longitude <span style={{ color: '#ef4444' }}>*</span></label>
            <input value={form.lng} onChange={e => set({ lng: e.target.value })} className={inputClass} style={inputStyle} placeholder="23.3084" />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Phones <span className="font-normal" style={{ color: '#475569' }}>(comma-separated)</span></label>
            <input value={form.phones} onChange={e => set({ phones: e.target.value })} className={inputClass} style={inputStyle} placeholder="+359 2 915 4411, +359 2 915 4200" />
          </div>
        </div>

        {/* 24/7 toggle */}
        <label className="flex items-center justify-between rounded-xl px-3.5 py-3 cursor-pointer"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.1)' }}>
          <div>
            <div className="text-sm font-semibold text-slate-200">24/7 emergency care</div>
            <div className="text-[11px]" style={{ color: '#64748b' }}>Always open — working hours below are ignored</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.emergency24h}
            onClick={() => set({ emergency24h: !form.emergency24h })}
            className="relative w-9 h-5 rounded-full transition-all flex-shrink-0"
            style={{ background: form.emergency24h ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'rgba(148,163,184,0.2)' }}
          >
            <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: form.emergency24h ? '18px' : '2px' }} />
          </button>
        </label>

        {/* Capabilities */}
        <div>
          <label className={labelClass}>Equipment & capabilities</label>
          <div className="flex flex-wrap gap-1.5">
            {HOSPITAL_CAPABILITIES.map(c => {
              const active = form.capabilities.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCapability(c)}
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all"
                  style={{
                    color: active ? '#04121f' : '#94a3b8',
                    background: active ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${active ? 'transparent' : 'rgba(148,163,184,0.12)'}`,
                  }}
                >
                  {CAPABILITY_LABELS[c]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Working hours */}
        {!form.emergency24h && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-400">Working hours</label>
              <button
                type="button"
                onClick={() => set({ hours: [...form.hours, { days: [1, 2, 3, 4, 5], open: '08:00', close: '18:00' }] })}
                className="text-xs font-semibold"
                style={{ color: '#22c55e' }}
              >
                + Add schedule
              </button>
            </div>
            {editing?.hoursText && (
              <div className="text-[11px] mb-2 px-2.5 py-1.5 rounded-lg" style={{ color: '#64748b', background: 'rgba(255,255,255,0.03)' }}>
                From OSM: <span className="font-mono">{editing.hoursText}</span>
              </div>
            )}
            {form.hours.length === 0 ? (
              <div className="text-[11px]" style={{ color: '#475569' }}>No structured schedule — the apps will show “hours unknown”.</div>
            ) : (
              <div className="space-y-2">
                {form.hours.map((rule, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap rounded-xl px-2.5 py-2"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.1)' }}>
                    <div className="flex gap-1">
                      {DAY_LABELS.map((d, day) => {
                        const on = rule.days.includes(day)
                        return (
                          <button key={day} type="button" onClick={() => toggleRuleDay(i, day)}
                            className="w-7 h-7 rounded-md text-[10px] font-bold transition-all"
                            style={{
                              color: on ? '#04121f' : '#64748b',
                              background: on ? '#22c55e' : 'rgba(255,255,255,0.05)',
                            }}>
                            {d}
                          </button>
                        )
                      })}
                    </div>
                    <input type="time" value={rule.open} onChange={e => e.target.value && updateRule(i, { open: e.target.value })}
                      className="px-2 py-1.5 rounded-lg text-xs text-slate-100 outline-none" style={{ ...inputStyle, colorScheme: 'dark' }} />
                    <span className="text-xs" style={{ color: '#64748b' }}>–</span>
                    <input type="time" value={rule.close} onChange={e => e.target.value && updateRule(i, { close: e.target.value })}
                      className="px-2 py-1.5 rounded-lg text-xs text-slate-100 outline-none" style={{ ...inputStyle, colorScheme: 'dark' }} />
                    <button type="button" onClick={() => set({ hours: form.hours.filter((_, idx) => idx !== i) })}
                      className="p-1.5 rounded-lg hover:bg-white/10 ml-auto">
                      <X className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        <div>
          <label className={labelClass}>Notes for responders</label>
          <textarea value={form.notes} onChange={e => set({ notes: e.target.value })} rows={2}
            className={`${inputClass} resize-none`} style={inputStyle}
            placeholder="e.g. Helipad on the roof, trauma team on call after 22:00…" />
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={() => { if (valid) void onSave(form) }}
            disabled={!valid || saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' }}
          >
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add hospital'}
          </button>
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
