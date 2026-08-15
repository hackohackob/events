'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BellRing, Loader2, Search, Smartphone, Trash2, AlertTriangle } from 'lucide-react'
import {
  fetchPushSubscriptions,
  deletePushSubscription,
  clearPushSubscriptions,
} from '@/api/notifications'
import type { PushSubscription } from '@/api/notifications'
import { fetchEvents } from '@/api/events'

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

const CARD = {
  background: 'rgba(20,33,61,0.8)',
  border: '1px solid rgba(148,163,184,0.08)',
  backdropFilter: 'blur(8px)',
}

interface ConfirmState {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
}

function ConfirmDialog({ state, onClose, pending }: { state: ConfirmState; onClose: () => void; pending: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4"
        style={{ background: '#0a1424', border: '1px solid rgba(148,163,184,0.12)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(239,68,68,0.12)' }}>
            <AlertTriangle className="w-5 h-5" style={{ color: '#f87171' }} />
          </div>
          <h2 className="text-base font-bold text-slate-100">{state.title}</h2>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: '#94a3b8' }}>{state.body}</p>
        <div className="flex gap-3 mt-1">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.15)', color: '#94a3b8' }}
          >
            Cancel
          </button>
          <button
            onClick={state.onConfirm}
            disabled={pending}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)', boxShadow: '0 4px 14px rgba(239,68,68,0.3)' }}
          >
            {pending && <Loader2 className="w-4 h-4 animate-spin" />}
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DevicesPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [eventFilter, setEventFilter] = useState('all')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  const { data: subs = [], isLoading } = useQuery({
    queryKey: ['push-subscriptions'],
    queryFn: () => fetchPushSubscriptions(),
    staleTime: 15_000,
  })

  const { data: events = [] } = useQuery({
    queryKey: ['events'],
    queryFn: fetchEvents,
    staleTime: 60_000,
  })

  const eventTitle = useMemo(() => {
    const map = new Map(events.map(e => [e.id, e.title]))
    return (id: string) => map.get(id) ?? id
  }, [events])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['push-subscriptions'] })

  const removeOne = useMutation({ mutationFn: deletePushSubscription, onSuccess: invalidate })
  const clearMany = useMutation({
    mutationFn: (eventId?: string) => clearPushSubscriptions(eventId),
    onSuccess: invalidate,
  })

  const pending = removeOne.isPending || clearMany.isPending

  const filtered = subs.filter(s => {
    const haystack = `${s.userName ?? ''} ${s.userId} ${s.deviceId ?? ''} ${eventTitle(s.eventId)}`.toLowerCase()
    const matchSearch = haystack.includes(search.toLowerCase())
    const matchEvent = eventFilter === 'all' || s.eventId === eventFilter
    return matchSearch && matchEvent
  })

  // Only events that actually have devices on them are worth filtering by.
  const eventIdsWithDevices = useMemo(
    () => Array.from(new Set(subs.map(s => s.eventId))),
    [subs]
  )

  const askRemoveOne = (sub: PushSubscription) => {
    const who = sub.userName ?? sub.userId
    setConfirm({
      title: 'Unsubscribe this device?',
      body: `${who}'s device will stop receiving incident alarms. It re-subscribes on its own the next time that phone opens the app and joins an event.`,
      confirmLabel: 'Unsubscribe',
      onConfirm: () => removeOne.mutate(sub.id, { onSuccess: () => setConfirm(null) }),
    })
  }

  const askClearAll = () => {
    const scoped = eventFilter !== 'all'
    setConfirm({
      title: scoped ? 'Clear devices on this event?' : 'Clear every device?',
      body: scoped
        ? `All ${filtered.length} device(s) registered to "${eventTitle(eventFilter)}" will stop receiving alarms until they reopen the app.`
        : `All ${subs.length} registered device(s) will stop receiving alarms until they reopen the app. Nobody's phone will ring for any event until then.`,
      confirmLabel: 'Clear',
      onConfirm: () =>
        clearMany.mutate(scoped ? eventFilter : undefined, { onSuccess: () => setConfirm(null) }),
    })
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Header */}
      <div
        className="flex items-center justify-between px-8 py-5"
        style={{
          borderBottom: '1px solid rgba(148,163,184,0.08)',
          background: 'rgba(12,21,39,0.6)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div>
          <h1 className="text-xl font-bold text-slate-100">Devices</h1>
          <p className="text-sm mt-0.5" style={{ color: '#64748b' }}>
            {subs.length} device{subs.length === 1 ? '' : 's'} will ring on an incident
            {' · '}
            {eventIdsWithDevices.length} event{eventIdsWithDevices.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          onClick={askClearAll}
          disabled={filtered.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 disabled:opacity-40"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
        >
          <Trash2 className="w-4 h-4" />
          {eventFilter === 'all' ? 'Clear all' : 'Clear this event'}
        </button>
      </div>

      {/* Explainer — this page exists to stop surprise 3am alarms. */}
      <div className="px-8 pt-5">
        <div className="flex items-start gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.18)' }}>
          <BellRing className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#60a5fa' }} />
          <p className="text-xs leading-relaxed" style={{ color: '#94a3b8' }}>
            A phone rings for an incident only while it is listed here. Each device is subscribed to
            exactly one event — the last one it joined. Clearing a device takes effect immediately,
            even if that phone never opens the app again.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-8 py-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#64748b' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name or device..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-slate-200 outline-none transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)' }}
            onFocus={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.4)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)')}
          />
        </div>
        <select
          value={eventFilter}
          onChange={e => setEventFilter(e.target.value)}
          className="px-3 py-2.5 rounded-xl text-sm outline-none appearance-none cursor-pointer"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)', color: '#94a3b8' }}
        >
          <option value="all">All Events</option>
          {eventIdsWithDevices.map(id => (
            <option key={id} value={id} style={{ background: '#0a1424' }}>{eventTitle(id)}</option>
          ))}
        </select>
      </div>

      {/* Device list */}
      <div className="flex-1 px-8 pb-8 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <Smartphone className="w-8 h-8 text-slate-600" />
            </div>
            <div className="text-slate-400 font-medium">No devices subscribed</div>
            <div className="text-sm text-slate-600">Nothing will ring on an incident right now</div>
          </div>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={CARD}>
            {filtered.map((sub, i) => (
              <div
                key={sub.id}
                className="flex items-center gap-4 px-5 py-4 group"
                style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(148,163,184,0.06)' }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(34,197,94,0.1)' }}
                >
                  <Smartphone className="w-5 h-5" style={{ color: '#22c55e' }} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-100 text-sm truncate">
                    {sub.userName ?? <span style={{ color: '#64748b' }}>Unknown medic</span>}
                  </div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: '#64748b' }}>
                    {sub.deviceId ?? 'Unnamed device'} · {sub.platform} · …{sub.tokenPreview}
                  </div>
                </div>

                <div className="hidden md:block min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate" style={{ color: '#94a3b8' }}>
                    {eventTitle(sub.eventId)}
                  </div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: '#64748b' }}>
                    {sub.userId}
                  </div>
                </div>

                <div className="text-xs whitespace-nowrap" style={{ color: '#64748b' }}>
                  {relativeTime(sub.updatedAt)}
                </div>

                <button
                  onClick={() => askRemoveOne(sub)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all md:opacity-0 md:group-hover:opacity-100"
                  style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.15)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
                >
                  Unsubscribe
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} pending={pending} />
      )}
    </div>
  )
}
