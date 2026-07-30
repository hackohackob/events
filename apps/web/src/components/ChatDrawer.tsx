'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Send, MessageCircle, AlertTriangle, Navigation, MapPin, Radio, ExternalLink } from 'lucide-react'
import type { EventMessage, EventFeedType, PttMessageOrigin } from '@events/contracts'
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

/** Colour + label for messages relayed in from a PTT network. */
const ORIGIN: Partial<Record<PttMessageOrigin, { color: string; label: string }>> = {
  zello: { color: '#f59e0b', label: 'Zello' },
  radio: { color: '#38bdf8', label: 'Radio' },
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
  /** Frame a shared location on the dashboard map (chat stays open). */
  onFocusLocation?: (point: { lat: number; lng: number }) => void
}

export default function ChatDrawer({ messages, loading, onSend, onClose, onFocusLocation }: Props) {
  const [myId] = useState(selfUserId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  /** False once the reader scrolls up — don't yank them back down mid-read. */
  const pinnedRef = useRef(true)
  /** The first scroll after open must not animate; there is nothing to animate from. */
  const firstScrollRef = useRef(true)

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: firstScrollRef.current ? 'auto' : 'smooth' })
    firstScrollRef.current = false
  }

  // Scroll after the browser has laid the new rows out — doing it in the same
  // frame measures the *previous* scrollHeight and lands short of the bottom,
  // which is why the drawer used to open mid-history.
  useEffect(() => {
    if (!pinnedRef.current) return
    const raf = requestAnimationFrame(() => requestAnimationFrame(scrollToBottom))
    return () => cancelAnimationFrame(raf)
  }, [messages, loading])

  // Avatars, photos and voice players resolve their height after the row is
  // already in the DOM; each of those growths has to re-pin the view.
  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom()
    })
    observer.observe(content)
    return () => observer.disconnect()
    // The list only exists once loading has finished with at least one message,
    // so re-attach when that flips.
  }, [loading, messages.length === 0])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

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
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm" style={{ color: '#475569' }}>Loading…</div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 px-8 text-center">
              <MessageCircle className="w-8 h-8" style={{ color: '#26384f' }} />
              <div className="text-sm font-bold" style={{ color: '#7d8ea4' }}>No messages yet</div>
              <div className="text-xs" style={{ color: '#475569' }}>Incidents, responses and new points show up here automatically.</div>
            </div>
          ) : (
            <div ref={contentRef} className="px-4 py-3 space-y-0.5">
            {rows.map(({ msg, mine, showHeader, dateSep }) => (
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
                  <Bubble msg={msg} mine={mine} showHeader={showHeader} onFocusLocation={onFocusLocation} />
                )}
              </div>
            ))}
            </div>
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

function Bubble({
  msg, mine, showHeader, onFocusLocation,
}: {
  msg: EventMessage
  mine: boolean
  showHeader: boolean
  onFocusLocation?: (point: { lat: number; lng: number }) => void
}) {
  const name = msg.authorName || 'Team'
  const origin = msg.origin && msg.origin !== 'app' ? ORIGIN[msg.origin] : undefined
  return (
    <div className={`flex items-end gap-2 my-0.5 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && (
        <div className="w-7 flex-shrink-0">
          {showHeader && (
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white"
              style={origin
                ? { background: `${origin.color}22`, border: `1px solid ${origin.color}66`, color: origin.color }
                : { background: avatarColor(name) }}
            >
              {origin ? <Radio className="w-3.5 h-3.5" /> : initials(name)}
            </div>
          )}
        </div>
      )}
      <div style={{ maxWidth: '78%' }}>
        {showHeader && !mine && (
          <div className="flex items-center gap-1.5 mb-0.5 ml-1">
            <span className="text-[11px] font-bold" style={{ color: origin ? origin.color : '#7e93ac' }}>{name}</span>
            {origin && (
              <span
                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ background: `${origin.color}1e`, color: origin.color }}
              >
                {origin.label}
              </span>
            )}
          </div>
        )}
        <div
          className="rounded-2xl px-3 py-2"
          style={mine
            ? { background: '#34d399', borderTopRightRadius: 5 }
            : origin
              ? { background: '#142235', borderTopLeftRadius: 5, borderLeft: `2px solid ${origin.color}` }
              : { background: '#142235', borderTopLeftRadius: 5 }}
        >
          {msg.audioUrl ? (
            <div style={{ minWidth: 180 }}>
              <VoiceMessage src={mediaSrc(msg.audioUrl)} durationMs={msg.audioDurationMs} transcript={msg.transcript} mine={mine} />
            </div>
          ) : msg.imageUrl ? (
            <a href={mediaSrc(msg.imageUrl)} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaSrc(msg.thumbnailUrl ?? msg.imageUrl)}
                alt={msg.text || 'Shared photo'}
                className="rounded-xl max-w-full"
                style={{ maxHeight: 240 }}
              />
              {msg.text && (
                <div className="text-sm leading-snug mt-1.5" style={{ color: mine ? '#04121f' : '#e6eef9' }}>{msg.text}</div>
              )}
            </a>
          ) : msg.location ? (
            <LocationCard location={msg.location} text={msg.text} mine={mine} onFocus={onFocusLocation} />
          ) : (
            <div className="text-sm leading-snug" style={{ color: mine ? '#04121f' : '#e6eef9', fontWeight: mine ? 500 : 400 }}>{msg.text}</div>
          )}
          <div className="text-[9.5px] mt-1 text-right" style={{ color: mine ? 'rgba(4,18,31,0.55)' : '#5f7088' }}>{fmtTime(msg.createdAt)}</div>
        </div>
      </div>
    </div>
  )
}

/**
 * A location shared into the chat. Clicking the card frames it on the
 * dashboard's own map — that is what a coordinator wants when a Zello user
 * drops a pin. The external-map link stays as a secondary affordance; nothing
 * leaves the dashboard unless that link is clicked.
 */
function LocationCard({
  location, text, mine, onFocus,
}: {
  location: NonNullable<EventMessage['location']>
  text?: string
  mine: boolean
  onFocus?: (point: { lat: number; lng: number }) => void
}) {
  const label = location.address ?? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
  // Bridged locations repeat the label in `text` so text-only clients still see
  // something — don't print it twice.
  const caption = text && text !== label ? text : null
  const osm = `https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=17/${location.lat}/${location.lng}`

  const body = (
    <>
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: mine ? 'rgba(4,18,31,0.15)' : 'rgba(52,211,153,0.15)' }}
      >
        <MapPin className="w-4 h-4" style={{ color: mine ? '#04121f' : '#34d399' }} />
      </div>
      <div className="min-w-0 text-left">
        <div className="text-[13px] font-semibold" style={{ color: mine ? '#04121f' : '#e6eef9' }}>{label}</div>
        <div className="text-[11px]" style={{ color: mine ? 'rgba(4,18,31,0.6)' : '#5f7088' }}>
          {caption ?? (location.accuracyM ? `±${location.accuracyM} m` : 'Shared location')}
        </div>
      </div>
    </>
  )

  if (!onFocus) {
    return (
      <a href={osm} target="_blank" rel="noreferrer" className="flex items-start gap-2.5" style={{ minWidth: 190 }}>
        {body}
      </a>
    )
  }

  return (
    <div className="flex items-start gap-1.5" style={{ minWidth: 190 }}>
      <button
        onClick={() => onFocus({ lat: location.lat, lng: location.lng })}
        className="flex items-start gap-2.5 flex-1 min-w-0 cursor-pointer"
        title="Show on the map"
      >
        {body}
      </button>
      <a
        href={osm}
        target="_blank"
        rel="noreferrer"
        title="Open in OpenStreetMap"
        className="flex-shrink-0 mt-1 opacity-50 hover:opacity-100"
        style={{ color: mine ? '#04121f' : '#9fb3cc' }}
      >
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  )
}
