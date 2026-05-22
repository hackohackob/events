'use client'

import { use } from 'react'
import Link from 'next/link'
import { ChevronRight, Calendar, MapPin, Users, Activity, Play, ArrowLeft, Edit } from 'lucide-react'
import { useEvent, useActivateEvent } from '@/hooks/useEvents'
import MapWrapper from '@/components/map/MapWrapper'
import { POI_CONFIGS } from '@/lib/constants'
import type { ApiEventSummary } from '@/api/events'

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)' },
  active: { label: 'Active', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.25)' },
  closed: { label: 'Closed', color: '#64748b', bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.2)' },
}

const POI_ICON: Record<string, string> = {
  'base-medical-camp': '🏠', 'ambulance': '🚑', 'medical-point': '➕',
  'water-point': '💧', 'wc': 'WC', 'wardrobe': '👕', 'parking': 'P', 'custom': '★',
}

function formatDates(dates: string[]): string {
  if (!dates || dates.length === 0) return '—'
  const fmt = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (dates.length === 1) return fmt(dates[0]) + ', ' + new Date(dates[0]).getFullYear()
  return fmt(dates[0]) + ' – ' + fmt(dates[dates.length - 1]) + ', ' + new Date(dates[0]).getFullYear()
}

export default function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: event, isLoading, isError } = useEvent(id)
  const activate = useActivateEvent()

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'rgba(34,197,94,0.3)', borderTopColor: '#22c55e' }} />
          <span className="text-sm" style={{ color: '#64748b' }}>Loading event...</span>
        </div>
      </div>
    )
  }

  if (isError || !event) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="text-slate-400 text-base">Event not found</div>
        <Link href="/events" className="text-sm text-green-400 hover:text-green-300 flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to Events
        </Link>
      </div>
    )
  }

  const status = STATUS_CONFIG[event.status]
  const allPois = (event.days || []).flatMap(d => d.pois || [])
  const allAssignments = (event.days || []).flatMap(d => d.assignments || [])
  const allTracks = (event.days || []).flatMap((day, di) =>
    (day.disciplines || []).map(disc => ({
      id: `${day.date}-${disc.name}`,
      name: disc.name,
      color: disc.color,
      coordinates: [] as [number, number][],
    }))
  )

  const mapPois = allPois.map((p, i) => ({
    id: `poi-${i}`,
    type: p.type as any,
    coordinates: [p.lng, p.lat] as [number, number],
    name: p.name,
  }))

  const totalDiscs = (event.days || []).reduce((s, d) => s + (d.disciplines || []).length, 0)
  const totalPois = allPois.length
  const medicalPois = allPois.filter(p => POI_CONFIGS.find(c => c.type === p.type)?.category === 'medical').length

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      {/* Header */}
      <div
        className="flex items-center justify-between px-8 py-4 flex-shrink-0"
        style={{
          borderBottom: '1px solid rgba(148,163,184,0.08)',
          background: 'rgba(10,20,36,0.9)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div className="flex items-center gap-3">
          <Link href="/events" className="text-sm transition-colors" style={{ color: '#64748b' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
            onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
          >
            Events
          </Link>
          <ChevronRight className="w-4 h-4 text-slate-600" />
          <span className="text-sm font-semibold text-slate-200 truncate max-w-xs">{event.title}</span>
          <span
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ color: status.color, background: status.bg, border: `1px solid ${status.border}` }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.color }} />
            {status.label}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {event.status === 'draft' && (
            <Link
              href="/events/create"
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.15)', color: '#94a3b8' }}
            >
              <Edit className="w-4 h-4" /> Edit Event
            </Link>
          )}
          {event.status === 'draft' && (
            <button
              onClick={() => activate.mutate(id)}
              disabled={activate.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-70"
              style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', boxShadow: '0 4px 14px rgba(34,197,94,0.35)' }}
            >
              <Play className="w-4 h-4" />
              {activate.isPending ? 'Activating...' : 'Activate Event'}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Event details */}
        <div
          className="w-[400px] flex-shrink-0 flex flex-col h-full overflow-y-auto"
          style={{ borderRight: '1px solid rgba(148,163,184,0.08)', background: 'rgba(10,18,34,0.6)' }}
        >
          <div className="p-6 space-y-5">
            {/* Image */}
            {event.imageUrl && (
              <div className="rounded-2xl overflow-hidden h-40">
                <img src={event.imageUrl} alt={event.title} className="w-full h-full object-cover" />
              </div>
            )}

            {/* Title & Meta */}
            <div>
              <h1 className="text-xl font-bold text-slate-100 mb-3">{event.title}</h1>
              <div className="space-y-2">
                <div className="flex items-center gap-2.5 text-sm" style={{ color: '#94a3b8' }}>
                  <Calendar className="w-4 h-4 flex-shrink-0" style={{ color: '#64748b' }} />
                  {formatDates(event.dates)}
                </div>
                {event.location && (
                  <div className="flex items-center gap-2.5 text-sm" style={{ color: '#94a3b8' }}>
                    <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: '#64748b' }} />
                    {event.location}
                  </div>
                )}
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Disciplines', value: totalDiscs, color: '#3b82f6', icon: <Activity className="w-4 h-4" /> },
                { label: 'Medics', value: allAssignments.length, color: '#8b5cf6', icon: <Users className="w-4 h-4" /> },
                { label: 'POIs', value: totalPois, color: '#ef4444', icon: <MapPin className="w-4 h-4" /> },
              ].map(({ label, value, color, icon }) => (
                <div key={label} className="rounded-2xl p-4 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.08)' }}>
                  <div className="flex justify-center mb-2" style={{ color }}>{icon}</div>
                  <div className="text-2xl font-bold text-slate-100">{value}</div>
                  <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Days breakdown */}
            {(event.days || []).length > 0 && (
              <div>
                <div className="text-xs font-semibold mb-3" style={{ color: '#64748b' }}>SCHEDULE</div>
                <div className="space-y-3">
                  {(event.days || []).map((day, i) => (
                    <div key={day.date} className="rounded-2xl p-4" style={{ background: 'rgba(20,33,61,0.8)', border: '1px solid rgba(148,163,184,0.08)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-slate-200">
                          Day {i + 1} — {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' })}
                        </span>
                        <div className="flex items-center gap-2">
                          {(day.pois || []).length > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
                              {(day.pois || []).length} POIs
                            </span>
                          )}
                          {(day.assignments || []).length > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}>
                              {(day.assignments || []).length} medics
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {(day.disciplines || []).map(disc => (
                          <div key={disc.name} className="flex items-center gap-2.5 text-xs">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: disc.color }} />
                            <span className="flex-1 text-slate-300 truncate">{disc.name}</span>
                            <span style={{ color: '#64748b' }}>{disc.distanceKm} km</span>
                            {disc.ascentMeters > 0 && <span style={{ color: '#64748b' }}>{disc.ascentMeters}m+</span>}
                          </div>
                        ))}
                        {(day.disciplines || []).length === 0 && (
                          <div className="text-xs" style={{ color: '#475569' }}>No disciplines</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Medical summary */}
            {medicalPois > 0 && (
              <div>
                <div className="text-xs font-semibold mb-3" style={{ color: '#64748b' }}>MEDICAL COVERAGE</div>
                <div className="grid grid-cols-2 gap-2">
                  {POI_CONFIGS.filter(c => c.category === 'medical').map(config => {
                    const count = allPois.filter(p => p.type === config.type).length
                    if (count === 0) return null
                    return (
                      <div key={config.type} className="flex items-center gap-2.5 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.06)' }}>
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: config.bg, color: config.color }}>
                          {POI_ICON[config.type]}
                        </div>
                        <div>
                          <div className="text-sm font-bold text-slate-200">{count}</div>
                          <div className="text-[10px] leading-tight" style={{ color: '#64748b' }}>{config.label}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Activation note for draft */}
            {event.status === 'draft' && (
              <div
                className="flex items-start gap-3 p-4 rounded-2xl"
                style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}
              >
                <Play className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
                <div className="text-xs" style={{ color: '#94a3b8' }}>
                  This event is in <span className="font-semibold text-amber-400">Draft</span> mode. Click <span className="font-semibold text-amber-400">Activate Event</span> to make it live — participants will be able to join via their mobile apps using the event code <span className="font-mono font-bold text-amber-400">{event.id}</span>.
                </div>
              </div>
            )}

            {event.status === 'active' && (
              <div
                className="flex items-start gap-3 p-4 rounded-2xl"
                style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}
              >
                <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 animate-pulse" style={{ background: '#22c55e' }} />
                <div className="text-xs" style={{ color: '#94a3b8' }}>
                  Event is <span className="font-semibold text-green-400">Live</span>. Participants join with code{' '}
                  <span className="font-mono font-bold text-green-400">{event.id}</span>.
                  Live location tracking is active.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Map */}
        <div className="flex-1 relative">
          <MapWrapper
            center={[23.3219, 42.6977]}
            zoom={11}
            pois={mapPois}
            tracks={allTracks}
          />

          {/* POI counts overlay */}
          {totalPois > 0 && (
            <div
              className="absolute bottom-4 left-4"
              style={{
                background: 'rgba(10,18,34,0.92)',
                backdropFilter: 'blur(12px)',
                borderRadius: '16px',
                border: '1px solid rgba(148,163,184,0.12)',
                padding: '12px 16px',
              }}
            >
              <div className="flex items-center gap-3">
                {POI_CONFIGS.map(config => {
                  const count = allPois.filter(p => p.type === config.type).length
                  if (count === 0) return null
                  return (
                    <div key={config.type} className="flex flex-col items-center gap-1">
                      <div className="w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold" style={{ background: config.bg, color: config.color }}>
                        {POI_ICON[config.type]}
                      </div>
                      <div className="text-xs font-bold text-slate-200">{count}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
