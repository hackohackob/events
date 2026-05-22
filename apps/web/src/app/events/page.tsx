'use client'

import Link from 'next/link'
import { Plus, Calendar, MapPin, Users, Activity, ChevronRight } from 'lucide-react'
import { useEvents } from '@/hooks/useEvents'
import type { ApiEventSummary } from '@/api/events'

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', dot: '#f59e0b' },
  active: { label: 'Active', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', dot: '#22c55e' },
  closed: { label: 'Closed', color: '#64748b', bg: 'rgba(100,116,139,0.12)', dot: '#64748b' },
}

function formatEventDates(dates: string[]): string {
  if (!dates || dates.length === 0) return '—'
  const fmt = (s: string) => {
    const d = new Date(s)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  if (dates.length === 1) {
    return fmt(dates[0]) + ', ' + new Date(dates[0]).getFullYear()
  }
  return fmt(dates[0]) + ' – ' + fmt(dates[dates.length - 1]) + ', ' + new Date(dates[0]).getFullYear()
}

function EventCard({ event }: { event: ApiEventSummary }) {
  const status = STATUS_CONFIG[event.status]
  return (
    <Link
      href={`/events/${event.id}`}
      className="group rounded-2xl overflow-hidden transition-all duration-200"
      style={{
        background: 'rgba(20,33,61,0.8)',
        border: '1px solid rgba(148,163,184,0.08)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.border = '1px solid rgba(148,163,184,0.2)'
        ;(e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'
        ;(e.currentTarget as HTMLElement).style.boxShadow = '0 12px 40px rgba(0,0,0,0.35)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.border = '1px solid rgba(148,163,184,0.08)'
        ;(e.currentTarget as HTMLElement).style.transform = 'translateY(0)'
        ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
      }}
    >
      {/* Image */}
      <div className="relative h-44 overflow-hidden">
        {event.imageUrl ? (
          <img
            src={event.imageUrl}
            alt={event.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full" style={{ background: 'linear-gradient(135deg, #1a2b4a 0%, #0a1424 100%)' }} />
        )}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(7,14,27,0.8) 0%, transparent 60%)' }} />
        <div className="absolute top-3 right-3">
          <span
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
            style={{ color: status.color, background: status.bg, backdropFilter: 'blur(8px)' }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.dot }} />
            {status.label}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="font-bold text-slate-100 text-base leading-tight">{event.title}</h3>
          <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 flex-shrink-0 transition-colors mt-0.5" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm" style={{ color: '#94a3b8' }}>
            <Calendar className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#64748b' }} />
            <span>{formatEventDates(event.dates)}</span>
          </div>
          {event.location && (
            <div className="flex items-center gap-2 text-sm" style={{ color: '#94a3b8' }}>
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#64748b' }} />
              <span>{event.location}</span>
            </div>
          )}
        </div>

        <div
          className="flex items-center gap-4 mt-4 pt-4"
          style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}
        >
          <div className="flex items-center gap-1.5 text-xs" style={{ color: '#64748b' }}>
            <Activity className="w-3 h-3" style={{ color: '#22c55e' }} />
            <span><span className="text-slate-300 font-medium">{event.disciplineCount}</span> disciplines</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs" style={{ color: '#64748b' }}>
            <Users className="w-3 h-3" style={{ color: '#8b5cf6' }} />
            <span><span className="text-slate-300 font-medium">{event.medicCount}</span> medics</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

export default function EventsPage() {
  const { data: events, isLoading, isError } = useEvents()

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
          <h1 className="text-xl font-bold text-slate-100">Events</h1>
          <p className="text-sm mt-0.5" style={{ color: '#64748b' }}>
            {isLoading ? 'Loading...' : `${events?.length ?? 0} events total`}
          </p>
        </div>
        <Link
          href="/events/create"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-95"
          style={{
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            boxShadow: '0 4px 14px rgba(34,197,94,0.35)',
          }}
        >
          <Plus className="w-4 h-4" />
          Create New Event
        </Link>
      </div>

      {/* Events grid */}
      <div className="p-8">
        {isError && (
          <div
            className="mb-6 px-4 py-3 rounded-xl text-sm"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
          >
            Failed to load events. Make sure the backend is running.
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className="rounded-2xl h-64 animate-pulse"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.08)' }}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
            {(events ?? []).map(event => (
              <EventCard key={event.id} event={event} />
            ))}

            {/* Create new card */}
            <Link
              href="/events/create"
              className="rounded-2xl flex flex-col items-center justify-center gap-3 h-64 transition-all duration-200 cursor-pointer group"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '2px dashed rgba(148,163,184,0.15)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.border = '2px dashed rgba(34,197,94,0.4)'
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(34,197,94,0.04)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.border = '2px dashed rgba(148,163,184,0.15)'
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'
              }}
            >
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all group-hover:scale-110"
                style={{ background: 'rgba(34,197,94,0.1)' }}
              >
                <Plus className="w-6 h-6" style={{ color: '#22c55e' }} />
              </div>
              <div className="text-center">
                <div className="font-semibold text-slate-400 group-hover:text-slate-300 transition-colors">Create New Event</div>
                <div className="text-sm mt-0.5" style={{ color: '#64748b' }}>Set up a new race event</div>
              </div>
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
