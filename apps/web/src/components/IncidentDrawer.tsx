'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Send, CheckCircle2, MessageSquare, ClipboardList, AlertTriangle, MapPin } from 'lucide-react'
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

interface Props {
  incident: LiveIncident
  messages: IncidentMessage[]
  onClose: () => void
  onResolve: (id: string) => Promise<void>
  onCloseIncident: (id: string, payload: { vitals?: string; treatment?: string; transport?: string }) => Promise<void>
  onSendMessage: (id: string, text: string) => Promise<void>
  loadMessages: (id: string) => Promise<void>
}

export default function IncidentDrawer({
  incident, messages, onClose, onResolve, onCloseIncident, onSendMessage, loadMessages,
}: Props) {
  const [tab, setTab] = useState<'details' | 'chat'>('details')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [vitals, setVitals] = useState('')
  const [treatment, setTreatment] = useState('')
  const [transport, setTransport] = useState('')
  const [busy, setBusy] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const st = STATUS_STYLE[incident.status] ?? STATUS_STYLE.open
  const isClosed = incident.status === 'closed'

  useEffect(() => { void loadMessages(incident.id) }, [incident.id, loadMessages])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length, tab])

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
    <div className="fixed inset-0" style={{ zIndex: 70 }}>
      <div className="absolute inset-0" style={{ background: 'rgba(5,10,20,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div
        className="absolute top-0 right-0 h-full flex flex-col"
        style={{ width: 440, maxWidth: '95vw', background: 'rgba(8,15,28,0.99)', borderLeft: '1px solid rgba(148,163,184,0.12)', boxShadow: '-24px 0 80px rgba(0,0,0,0.6)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: st.bg, border: `1px solid ${st.color}40` }}>
              <AlertTriangle className="w-5 h-5" style={{ color: st.color }} />
            </div>
            <div className="min-w-0">
              <div className="text-base font-bold text-slate-100 truncate">{incident.name ?? 'Incident'}</div>
              <div className="text-xs capitalize" style={{ color: '#64748b' }}>{incident.type}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl flex-shrink-0" style={{ color: '#64748b', background: 'rgba(255,255,255,0.04)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status + tabs */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
          <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: st.bg, color: st.color }}>{st.label}</span>
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
            {(['details', 'chat'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={{ background: tab === t ? 'rgba(34,197,94,0.15)' : 'transparent', color: tab === t ? '#22c55e' : '#64748b' }}
              >
                {t === 'details' ? <ClipboardList className="w-3.5 h-3.5" /> : <MessageSquare className="w-3.5 h-3.5" />}
                {t === 'details' ? 'Details' : `Chat${messages.length ? ` (${messages.length})` : ''}`}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {tab === 'details' ? (
            <div className="space-y-4">
              {incident.description && (
                <div>
                  <div className="text-[10px] font-bold tracking-widest mb-1" style={{ color: '#475569' }}>DESCRIPTION</div>
                  <div className="text-sm text-slate-300">{incident.description}</div>
                </div>
              )}

              {incident.photoUrl && (
                <img src={photoSrc(incident.photoUrl)} alt="incident" className="w-full rounded-xl" style={{ maxHeight: 220, objectFit: 'cover' }} />
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
                <div className="text-sm text-slate-300">{incident.reportedBy ?? 'Unknown'}</div>
              </div>

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
                messages.map(m => (
                  <div key={m.id} className="rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.07)' }}>
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-xs font-bold text-slate-200">{m.authorName}</span>
                      <span className="text-[10px]" style={{ color: '#475569' }}>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="text-sm text-slate-300">{m.text}</div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
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
