'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Send, CheckCircle2, MessageSquare, ClipboardList, AlertTriangle, MapPin, Pencil, Check, Phone, Pill, Droplet, HeartPulse } from 'lucide-react'
import VoiceMessage from './VoiceMessage'
import type { IncidentMessage } from '@events/contracts'
import type { LiveIncident } from '@/hooks/useLiveMap'
import { apiUrl } from '@/env'

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  open:        { label: 'Open',        color: '#f87171', bg: 'rgba(239,68,68,0.14)' },
  assigned:    { label: 'Assigned',    color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  in_progress: { label: 'In Progress', color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  resolved:    { label: 'Resolved',    color: '#22c55e', bg: 'rgba(34,197,94,0.14)' },
  closed:      { label: 'Closed',      color: '#64748b', bg: 'rgba(100,116,139,0.14)' },
}

function photoSrc(url?: string) {
  if (!url) return undefined
  if (url.startsWith('http')) return url
  return `${apiUrl.replace(/\/api$/, '')}${url}`
}

function timeAgo(iso?: string): string {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const SEVERITY_STYLE: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: '#ef4444' },
  high:     { label: 'High',     color: '#f97316' },
  moderate: { label: 'Moderate', color: '#f59e0b' },
  medium:   { label: 'Medium',   color: '#f59e0b' },
  low:      { label: 'Low',      color: '#22c55e' },
  minor:    { label: 'Minor',    color: '#22c55e' },
}

interface Props {
  incident: LiveIncident
  messages: IncidentMessage[]
  onClose: () => void
  onResolve: (id: string) => Promise<void>
  onCloseIncident: (id: string, payload: { vitals?: string; treatment?: string; transport?: string }) => Promise<void>
  onSendMessage: (id: string, text: string) => Promise<void>
  loadMessages: (id: string) => Promise<void>
  /** Medics available to dispatch to this incident. */
  availableMedics?: Array<{ medicId: string; name: string }>
  onAssignResponder?: (incidentId: string, medicId: string) => void
  onUnassignResponder?: (incidentId: string, medicId: string) => void
  /** medicId → display name, for showing current responders. */
  medicNameById?: Record<string, string>
  /** Save edited incident notes (description). */
  onUpdateNotes?: (incidentId: string, description: string) => Promise<void>
}

export default function IncidentDrawer({
  incident, messages, onClose, onResolve, onCloseIncident, onSendMessage, loadMessages,
  availableMedics = [], onAssignResponder, onUnassignResponder, medicNameById = {}, onUpdateNotes,
}: Props) {
  const [tab, setTab] = useState<'details' | 'chat'>('details')
  const [showAssign, setShowAssign] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [vitals, setVitals] = useState('')
  const [treatment, setTreatment] = useState('')
  const [transport, setTransport] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  async function saveNotes() {
    if (!onUpdateNotes || savingNotes) return
    setSavingNotes(true)
    try {
      await onUpdateNotes(incident.id, notesDraft.trim())
      setEditingNotes(false)
    } finally {
      setSavingNotes(false)
    }
  }

  const st = STATUS_STYLE[incident.status] ?? STATUS_STYLE.open
  const sev = incident.severity ? SEVERITY_STYLE[incident.severity.toLowerCase()] : undefined
  const isClosed = incident.status === 'closed'

  // All photos attached to the incident — the legacy single photoUrl plus any
  // added later (gallery), deduped and oldest-first.
  const photos = (() => {
    const list = [...(incident.photoUrls ?? [])]
    if (incident.photoUrl && !list.includes(incident.photoUrl)) list.unshift(incident.photoUrl)
    return list
  })()

  useEffect(() => { void loadMessages(incident.id) }, [incident.id, loadMessages])
  // Scroll only the drawer body — scrollIntoView() here used to scroll every
  // scrollable ancestor too, sending the page (and the map under it) flying.
  useEffect(() => {
    if (tab !== 'chat') return
    const el = chatScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, tab])

  async function handleSend() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await onSendMessage(incident.id, text)
      setDraft('')
    } finally {
      setSending(false)
    }
  }

  async function handleCloseIncident() {
    setBusy(true)
    try {
      await onCloseIncident(incident.id, {
        vitals: vitals.trim() || undefined,
        treatment: treatment.trim() || undefined,
        transport: transport.trim() || undefined,
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    // pointer-events-none on the wrapper so the map stays pannable/zoomable next
    // to the drawer; only the panel itself captures input. No backdrop blur or
    // dim — the operator needs to keep watching the live map while triaging.
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 70 }}>
      <div
        className="absolute top-0 right-0 h-full flex flex-col pointer-events-auto"
        style={{ width: 440, maxWidth: '95vw', background: 'rgba(8,15,28,0.99)', borderLeft: '1px solid rgba(148,163,184,0.12)', boxShadow: '-24px 0 80px rgba(0,0,0,0.6)' }}
      >
        {/* Severity / status accent bar */}
        <div className="flex-shrink-0" style={{ height: 4, background: sev?.color ?? st.color }} />

        {/* Hero header */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 flex-shrink-0">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: st.bg, border: `1px solid ${st.color}55` }}>
            <AlertTriangle className="w-[22px] h-[22px]" style={{ color: st.color }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-bold text-slate-100 truncate leading-tight">{incident.name ?? 'Incident'}</div>
            <div className="text-xs capitalize mt-0.5" style={{ color: '#64748b' }}>{incident.type}</div>
          </div>
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0" style={{ background: st.bg, color: st.color }}>{st.label}</span>
          <button onClick={onClose} className="p-2 rounded-xl flex-shrink-0" style={{ color: '#64748b', background: 'rgba(255,255,255,0.04)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-3 gap-2 px-5 pb-3 flex-shrink-0">
          {[
            { label: 'Reported', value: timeAgo(incident.createdAt) },
            { label: 'Responders', value: String((incident.responders ?? []).length) },
            { label: 'Severity', value: sev?.label ?? '—', color: sev?.color },
          ].map((s) => (
            <div key={s.label} className="rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(148,163,184,0.08)' }}>
              <div className="text-[10px] font-bold tracking-wide" style={{ color: '#5b6b80' }}>{s.label.toUpperCase()}</div>
              <div className="text-[15px] font-bold mt-0.5 truncate" style={{ color: s.color ?? '#e2e8f0' }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Segmented tabs */}
        <div className="px-5 pb-3 flex-shrink-0">
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
            {(['details', 'chat'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
                style={{ background: tab === t ? 'rgba(34,197,94,0.15)' : 'transparent', color: tab === t ? '#22c55e' : '#64748b' }}
              >
                {t === 'details' ? <ClipboardList className="w-3.5 h-3.5" /> : <MessageSquare className="w-3.5 h-3.5" />}
                {t === 'details' ? 'Details' : `Chat${messages.length ? ` (${messages.length})` : ''}`}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-5 pb-4">
          {tab === 'details' ? (
            <div className="space-y-4">
              {/* Notes — always visible, editable by the dashboard. */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] font-bold tracking-widest" style={{ color: '#475569' }}>NOTES</div>
                  {onUpdateNotes && !editingNotes && (
                    <button
                      onClick={() => { setNotesDraft(incident.description ?? ''); setEditingNotes(true) }}
                      className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full"
                      style={{ color: '#34d399', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(52,211,153,0.35)' }}
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  )}
                </div>
                {editingNotes ? (
                  <div className="space-y-2">
                    <textarea
                      value={notesDraft}
                      onChange={e => setNotesDraft(e.target.value)}
                      rows={4}
                      autoFocus
                      placeholder="What's happening on scene, access notes, hazards…"
                      className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-y placeholder:text-slate-600"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void saveNotes()}
                        disabled={savingNotes}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}
                      >
                        <Check className="w-3.5 h-3.5" /> {savingNotes ? 'Saving…' : 'Save notes'}
                      </button>
                      <button
                        onClick={() => setEditingNotes(false)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                        style={{ background: 'rgba(255,255,255,0.05)', color: '#64748b' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm" style={{ color: incident.description ? '#cbd5e1' : '#475569' }}>
                    {incident.description || 'No notes yet.'}
                  </div>
                )}
              </div>

              {photos.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold tracking-widest mb-1" style={{ color: '#475569' }}>
                    PHOTOS{photos.length > 1 ? ` (${photos.length})` : ''}
                  </div>
                  {photos.length === 1 ? (
                    <a href={photoSrc(photos[0])} target="_blank" rel="noreferrer">
                      <img src={photoSrc(photos[0])} alt="incident" className="w-full rounded-xl" style={{ maxHeight: 220, objectFit: 'cover' }} />
                    </a>
                  ) : (
                    <div className="grid grid-cols-3 gap-1.5">
                      {photos.map((p, i) => (
                        <a key={i} href={photoSrc(p)} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden" style={{ aspectRatio: '1', border: '1px solid rgba(148,163,184,0.12)' }}>
                          <img src={photoSrc(p)} alt={`incident ${i + 1}`} className="w-full h-full" style={{ objectFit: 'cover' }} />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 text-xs" style={{ color: '#64748b' }}>
                <MapPin className="w-3.5 h-3.5" />
                {incident.lat.toFixed(5)}, {incident.lng.toFixed(5)}
                {incident.responders && incident.responders.length > 0 && (
                  <span className="ml-auto">{incident.responders.length} responder{incident.responders.length > 1 ? 's' : ''}</span>
                )}
              </div>

              <div>
                <div className="text-[10px] font-bold tracking-widest mb-1" style={{ color: '#475569' }}>REPORTED BY</div>
                <div className="text-sm text-slate-300">
                  {incident.reportedBy ?? 'Unknown'}
                  <span className="text-slate-500"> ({incident.createdBy?.startsWith('runner_') ? 'Participant' : 'Medic'})</span>
                  {incident.reporterPhone && (
                    <a href={`tel:${incident.reporterPhone}`} className="ml-2 inline-flex items-center gap-1 font-medium" style={{ color: '#22c55e' }}>
                      <Phone className="w-3 h-3" /> {incident.reporterPhone}
                    </a>
                  )}
                </div>
              </div>

              {/* Patient (when reporting for someone else) + medical — compact */}
              {(incident.patientBib || incident.patientName || incident.patientPhone || incident.allergies || incident.medications || incident.bloodType || incident.conditions) && (
                <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.16)' }}>
                  <div className="text-[10px] font-bold tracking-widest" style={{ color: '#f87171' }}>PATIENT</div>
                  {(incident.patientName || incident.patientBib || incident.patientPhone) && (
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-sm text-slate-200">
                      {incident.patientName && <span className="font-semibold">{incident.patientName}</span>}
                      {incident.patientBib && (
                        <span className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>#{incident.patientBib}</span>
                      )}
                      {incident.patientPhone && (
                        <a href={`tel:${incident.patientPhone}`} className="inline-flex items-center gap-1 font-medium" style={{ color: '#22c55e' }}>
                          <Phone className="w-3 h-3" /> {incident.patientPhone}
                        </a>
                      )}
                    </div>
                  )}
                  {(incident.allergies || incident.medications || incident.bloodType || incident.conditions) && (
                    <div className="flex flex-wrap gap-1.5">
                      {incident.bloodType && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md font-semibold" style={{ background: 'rgba(239,68,68,0.2)', color: '#fca5a5' }}>
                          <Droplet className="w-3 h-3" /> {incident.bloodType}
                        </span>
                      )}
                      {incident.allergies && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md" style={{ background: 'rgba(239,68,68,0.14)', color: '#fca5a5' }}>
                          <AlertTriangle className="w-3 h-3" /> {incident.allergies}
                        </span>
                      )}
                      {incident.medications && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md" style={{ background: 'rgba(168,85,247,0.14)', color: '#c4b5fd' }}>
                          <Pill className="w-3 h-3" /> {incident.medications}
                        </span>
                      )}
                      {incident.conditions && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md" style={{ background: 'rgba(245,158,11,0.14)', color: '#fcd34d' }}>
                          <HeartPulse className="w-3 h-3" /> {incident.conditions}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Responders + assign */}
              {!isClosed && onAssignResponder && (
                <div>
                  <div className="text-[10px] font-bold tracking-widest mb-1.5" style={{ color: '#475569' }}>RESPONDERS</div>
                  {(incident.responders ?? []).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {(incident.responders ?? []).map(id => {
                        const nm = medicNameById[id] ?? id.slice(0, 6)
                        const inits = nm.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
                        return (
                          <span key={id} className="inline-flex items-center gap-1.5 text-xs pl-1 pr-1 py-1 rounded-lg" style={{ background: 'rgba(34,197,94,0.12)', color: '#34d399', border: '1px solid rgba(34,197,94,0.25)' }}>
                            <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: '#0f6e56' }}>{inits}</span>
                            <span className="font-semibold">{nm}</span>
                            {onUnassignResponder && (
                              <button
                                onClick={() => onUnassignResponder(incident.id, id)}
                                title="Unassign medic"
                                className="flex items-center justify-center w-4 h-4 rounded hover:bg-white/10 transition-colors"
                                style={{ color: '#34d399' }}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="text-xs mb-2" style={{ color: '#64748b' }}>No responders yet.</div>
                  )}
                  {!showAssign ? (
                    <button
                      onClick={() => setShowAssign(true)}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
                      style={{ background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.3)', color: '#60a5fa' }}
                    >
                      + Assign medic
                    </button>
                  ) : (
                    <div className="rounded-xl p-2 space-y-1" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.12)' }}>
                      {availableMedics.length === 0 ? (
                        <div className="text-xs px-2 py-1.5" style={{ color: '#64748b' }}>No medics online.</div>
                      ) : (
                        availableMedics.map(m => {
                          const already = (incident.responders ?? []).includes(m.medicId)
                          return (
                            <button
                              key={m.medicId}
                              disabled={already}
                              onClick={() => { onAssignResponder(incident.id, m.medicId); setShowAssign(false) }}
                              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all"
                              style={{ background: already ? 'transparent' : 'rgba(255,255,255,0.04)', color: already ? '#475569' : '#e2e8f0', cursor: already ? 'default' : 'pointer' }}
                            >
                              <span>{m.name}</span>
                              <span style={{ color: already ? '#22c55e' : '#60a5fa', fontWeight: 700 }}>{already ? '✓ assigned' : 'Send →'}</span>
                            </button>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Casualty handover (when closed) */}
              {(incident.vitals || incident.treatment || incident.transport) && (
                <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.18)' }}>
                  <div className="text-[10px] font-bold tracking-widest" style={{ color: '#22c55e' }}>CASUALTY HANDOVER</div>
                  {incident.vitals && <HandoverRow label="Vitals" value={incident.vitals} />}
                  {incident.treatment && <HandoverRow label="Treatment" value={incident.treatment} />}
                  {incident.transport && <HandoverRow label="Transport" value={incident.transport} />}
                </div>
              )}

              {!isClosed && (
                <div className="space-y-2 pt-1">
                  {incident.status !== 'resolved' && (
                    <button
                      onClick={() => void onResolve(incident.id)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
                      style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}
                    >
                      <CheckCircle2 className="w-4 h-4" /> Mark Resolved
                    </button>
                  )}

                  {!showClose ? (
                    <button
                      onClick={() => setShowClose(true)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
                      style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 4px 14px rgba(34,197,94,0.3)' }}
                    >
                      Close with handover
                    </button>
                  ) : (
                    <div className="rounded-xl p-3 space-y-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.1)' }}>
                      <div className="text-[10px] font-bold tracking-widest" style={{ color: '#64748b' }}>CASUALTY HANDOVER</div>
                      <CloseField label="Vitals" placeholder="BP, HR, SpO₂, GCS…" value={vitals} onChange={setVitals} />
                      <CloseField label="Treatment given" placeholder="Splint, O₂, meds…" value={treatment} onChange={setTreatment} />
                      <CloseField label="Transport" placeholder="Self-care / Ambulance to…" value={transport} onChange={setTransport} />
                      <div className="flex gap-2 pt-1">
                        <button onClick={handleCloseIncident} disabled={busy}
                          className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                          style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}>
                          {busy ? 'Closing…' : 'Close incident'}
                        </button>
                        <button onClick={() => setShowClose(false)} className="px-3 py-2.5 rounded-xl text-sm font-semibold"
                          style={{ background: 'rgba(255,255,255,0.05)', color: '#64748b' }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {messages.length === 0 ? (
                <div className="text-center text-xs py-10" style={{ color: '#475569' }}>No messages yet. Start the conversation.</div>
              ) : (
                messages.map(m => m.authorId === 'system' ? (
                  // Timeline log entry (reported / dispatched / arrived / …)
                  <div key={m.id} className="flex items-center gap-2 py-0.5">
                    <div className="flex-1 h-px" style={{ background: 'rgba(148,163,184,0.14)' }} />
                    <div className="text-[11px] font-semibold text-center" style={{ color: '#7d8ea4', maxWidth: '78%' }}>
                      {m.text}{' '}
                      <span style={{ color: '#48586c', fontSize: 10 }}>
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex-1 h-px" style={{ background: 'rgba(148,163,184,0.14)' }} />
                  </div>
                ) : (
                  <div key={m.id} className="rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.07)' }}>
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-xs font-bold text-slate-200">{m.authorName}</span>
                      <span className="text-[10px]" style={{ color: '#475569' }}>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    {m.audioUrl ? (
                      <div className="mt-1">
                        <VoiceMessage src={photoSrc(m.audioUrl) ?? ''} durationMs={m.audioDurationMs} transcript={m.transcript} />
                      </div>
                    ) : m.photoUrl ? (
                      <div className="mt-1">
                        <a href={photoSrc(m.photoUrl)} target="_blank" rel="noreferrer">
                          <img src={photoSrc(m.photoUrl)} alt="attachment" className="rounded-lg" style={{ maxHeight: 180, maxWidth: '100%', objectFit: 'cover' }} />
                        </a>
                        {m.text ? <div className="text-sm text-slate-300 mt-1">{m.text}</div> : null}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-300">{m.text}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Chat composer */}
        {tab === 'chat' && (
          <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleSend() }}
              placeholder="Message the response team…"
              className="flex-1 px-3 py-2.5 rounded-xl text-sm text-slate-100 outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.15)' }}
            />
            <button onClick={handleSend} disabled={!draft.trim() || sending}
              className="p-2.5 rounded-xl text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}>
              <Send className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function HandoverRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs">
      <span className="font-semibold text-slate-400">{label}: </span>
      <span className="text-slate-300">{value}</span>
    </div>
  )
}

function CloseField({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-[10px] font-semibold mb-1" style={{ color: '#64748b' }}>{label.toUpperCase()}</div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full px-2.5 py-2 rounded-lg text-xs text-slate-200 outline-none resize-none"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.15)' }}
      />
    </div>
  )
}
