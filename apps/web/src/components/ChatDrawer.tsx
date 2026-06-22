'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Send, MessageCircle, AlertTriangle, Navigation, MapPin } from 'lucide-react'
import type { EventMessage, EventFeedType } from '@events/contracts'
import { apiUrl } from '@/env'
import VoiceMessage from './VoiceMessage'

/** The dashboard's own user id, decoded from the session token (same as the API client). */
function selfUserId(): string | null {
  try {
    const token = localStorage.getItem('session_token')
    if (!token) return null
    return (JSON.parse(atob(token)) as { userId?: string }).userId ?? null
  } catch {
    return null
  }
}

function mediaSrc(url?: string) {
  if (!url) return ''
  if (url.startsWith('http')) return url
  return `${apiUrl.replace(/\/api$/, '')}${url}`
}

const FEED: Record<EventFeedType, { icon: typeof AlertTriangle; color: string; label: string }> = {
  incident: { icon: AlertTriangle, color: '#f87171', label: 'Incident' },
  response: { icon: Navigation, color: '#60a5fa', label: 'Responding' },
  poi: { icon: MapPin, color: '#34d399', label: 'New point' },
}

const AVATARS = ['#0f6e56', '#185fa5', '#7c3aed', '#b45309', '#9d174d', '#0e7490', '#4d7c0f']
function avatarColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATARS[h % AVATARS.length]
}
function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function dayLabel(iso: string) {
  const d = new Date(iso), t = new Date(), y = new Date()
  y.setDate(t.getDate() - 1)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, t)) return 'Today'
  if (same(d, y)) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

interface Props {
  messages: EventMessage[]
  loading: boolean
  onSend: (text: string) => Promise<void>
  onClose: () => void
}

export default function ChatDrawer({ messages, loading, onSend, onClose }: Props) {
  const [myId] = useState(selfUserId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const rows = useMemo(() => {
    return messages.map((msg, i) => {
      const prev = messages[i - 1]
      const mine = msg.authorId != null && msg.authorId === myId
      const gapMin = prev ? (new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime()) / 60000 : 999
      const showHeader =
        msg.kind !== 'system' && (!prev || prev.kind === 'system' || prev.authorId !== msg.authorId || gapMin > 5)
      const dateSep = !prev || dayLabel(prev.createdAt) !== dayLabel(msg.createdAt) ? dayLabel(msg.createdAt) : null
      return { msg, mine, showHeader, dateSep }
    })
  }, [messages, myId])

  const submit = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setDraft('')
    try {
      await onSend(text)
    } catch {
      setDraft(text)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 70 }}>
      <div
        className="absolute top-0 right-0 h-full flex flex-col pointer-events-auto"
        style={{ width: 420, maxWidth: '95vw', background: 'rgba(8,15,28,0.99)', borderLeft: '1px solid rgba(148,163,184,0.12)', boxShadow: '-24px 0 80px rgba(0,0,0,0.6)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.35)' }}>
            <MessageCircle className="w-5 h-5" style={{ color: '#34d399' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">Team chat</div>
            <div className="text-xs" style={{ color: '#64748b' }}>Everyone on the event · live feed</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl flex-shrink-0" style={{ color: '#64748b', background: 'rgba(255,255,255,0.04)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm" style={{ color: '#475569' }}>Loading…</div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 px-8 text-center">
              <MessageCircle className="w-8 h-8" style={{ color: '#26384f' }} />
              <div className="text-sm font-bold" style={{ color: '#7d8ea4' }}>No messages yet</div>
              <div className="text-xs" style={{ color: '#475569' }}>Incidents, responses and new points show up here automatically.</div>
            </div>
          ) : (
            rows.map(({ msg, mine, showHeader, dateSep }) => (
              <div key={msg.id}>
                {dateSep && (
                  <div className="flex items-center gap-3 my-3 px-6">
                    <div className="flex-1 h-px" style={{ background: 'rgba(148,163,184,0.12)' }} />
                    <span className="text-[11px] font-bold" style={{ color: '#5f7088' }}>{dateSep}</span>
                    <div className="flex-1 h-px" style={{ background: 'rgba(148,163,184,0.12)' }} />
                  </div>
                )}
                {msg.kind === 'system' ? (
                  <SystemCard msg={msg} />
                ) : (
                  <Bubble msg={msg} mine={mine} showHeader={showHeader} />
                )}
              </div>
            ))
          )}
        </div>

        {/* Composer */}
        <div className="flex items-end gap-2 px-3 py-3 flex-shrink-0" style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }}
            rows={1}
            placeholder="Message the team…"
            className="flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm outline-none placeholder:text-slate-600"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.16)', color: '#e2e8f0', maxHeight: 120 }}
          />
          <button
            onClick={() => void submit()}
            disabled={!draft.trim() || sending}
            className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 disabled:opacity-50 transition-transform active:scale-95"
            style={{ background: '#34d399' }}
          >
            <Send className="w-[18px] h-[18px]" style={{ color: '#04121f' }} />
          </button>
        </div>
      </div>
    </div>
  )
}

function SystemCard({ msg }: { msg: EventMessage }) {
  const meta = FEED[msg.feedType ?? 'incident']
  const Icon = meta.icon
  return (
    <div className="flex justify-center my-1.5">
      <div className="flex items-center gap-2.5 rounded-xl px-3 py-2 max-w-[92%]" style={{ background: `${meta.color}12`, border: `1px solid ${meta.color}33` }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${meta.color}22`, border: `1px solid ${meta.color}44` }}>
          <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: meta.color }}>{meta.label}</div>
          <div className="text-[13px]" style={{ color: '#d6e2f0' }}>{msg.text}</div>
        </div>
        <span className="text-[10px] self-start" style={{ color: '#5f7088' }}>{fmtTime(msg.createdAt)}</span>
      </div>
    </div>
  )
}

function Bubble({ msg, mine, showHeader }: { msg: EventMessage; mine: boolean; showHeader: boolean }) {
  const name = msg.authorName || 'Team'
  return (
    <div className={`flex items-end gap-2 my-0.5 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && (
        <div className="w-7 flex-shrink-0">
          {showHeader && (
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white" style={{ background: avatarColor(name) }}>
              {initials(name)}
            </div>
          )}
        </div>
      )}
      <div style={{ maxWidth: '78%' }}>
        {showHeader && !mine && <div className="text-[11px] font-bold mb-0.5 ml-1" style={{ color: '#7e93ac' }}>{name}</div>}
        <div
          className="rounded-2xl px-3 py-2"
          style={mine
            ? { background: '#34d399', borderTopRightRadius: 5 }
            : { background: '#142235', borderTopLeftRadius: 5 }}
        >
          {msg.audioUrl ? (
            <div style={{ minWidth: 180 }}>
              <VoiceMessage src={mediaSrc(msg.audioUrl)} durationMs={msg.audioDurationMs} transcript={msg.transcript} mine={mine} />
            </div>
          ) : (
            <div className="text-sm leading-snug" style={{ color: mine ? '#04121f' : '#e6eef9', fontWeight: mine ? 500 : 400 }}>{msg.text}</div>
          )}
          <div className="text-[9.5px] mt-1 text-right" style={{ color: mine ? 'rgba(4,18,31,0.55)' : '#5f7088' }}>{fmtTime(msg.createdAt)}</div>
        </div>
      </div>
    </div>
  )
}
