'use client'

import { use, useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  ChevronRight, Calendar, MapPin, Users, Activity,
  Play, ArrowLeft, Edit, Wifi, WifiOff, User, Navigation,
  Layers, AlertTriangle, QrCode, X
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEvent, useActivateEvent } from '@/hooks/useEvents'
import { useLiveMap } from '@/hooks/useLiveMap'
import MapWrapper from '@/components/map/MapWrapper'
import { POI_CONFIGS } from '@/lib/constants'
import { fetchGpxCoordinates } from '@/lib/gpx'
import type { MedicState } from '@events/contracts'
import type { PointOfInterest, POIType } from '@/lib/types'

const STATUS_CONFIG = {
  draft:  { label: 'Draft',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)' },
  active: { label: 'Active', color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.25)' },
  closed: { label: 'Closed', color: '#64748b', bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.2)' },
}

const POI_ICON: Record<string, string> = {
  'base-medical-camp': '🏠', 'ambulance': '🚑', 'medical-point': '➕',
  'water-point': '💧', 'wc': 'WC', 'wardrobe': '👕', 'parking': 'P', 'mrs': '⛰️', 'custom': '★',
}

function formatDates(dates: string[]): string {
  if (!dates || dates.length === 0) return '—'
  const fmt = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (dates.length === 1) return fmt(dates[0]) + ', ' + new Date(dates[0]).getFullYear()
  return fmt(dates[0]) + ' – ' + fmt(dates[dates.length - 1]) + ', ' + new Date(dates[0]).getFullYear()
}

function msToLabel(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}

function isOnline(lastSeenAt: string) {
  return Date.now() - new Date(lastSeenAt).getTime() < 90_000
}

// ─── QR Modal ─────────────────────────────────────────────────────────────────

function QRModal({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 50, background: 'rgba(5,10,20,0.82)', backdropFilter: 'blur(14px)' }}
      onClick={onClose}
    >
      <div
        className="relative flex flex-col items-center gap-6 p-10 rounded-3xl"
        style={{
          maxWidth: 420, width: '90%',
          background: 'rgba(8,15,28,0.97)',
          border: '1px solid rgba(34,197,94,0.2)',
          boxShadow: '0 0 60px rgba(34,197,94,0.12), 0 24px 80px rgba(0,0,0,0.7)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl transition-colors"
          style={{ color: '#64748b', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.1)' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#e2e8f0')}
          onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center">
          <div className="text-xl font-bold text-slate-100 mb-1">Join Event</div>
          <div className="text-sm" style={{ color: '#64748b' }}>Scan with the MedEvac app to join instantly</div>
        </div>

        {/* QR Code */}
        <div
          className="p-4 rounded-2xl"
          style={{ background: '#fff' }}
        >
          <QRCodeSVG value={eventId} size={216} level="M" />
        </div>

        {/* Join code */}
        <div className="text-center">
          <div className="text-xs font-semibold mb-2" style={{ color: '#64748b' }}>JOIN CODE</div>
          <div className="font-mono text-4xl font-black tracking-widest" style={{ color: '#22c55e' }}>
            {eventId}
          </div>
        </div>

        <div className="text-xs text-center" style={{ color: '#475569' }}>
          Open the MedEvac mobile app → Join Event → scan or enter code above
        </div>
      </div>
    </div>
  )
}

// ─── Medic Row ────────────────────────────────────────────────────────────────

function MedicRow({ medic, onAssign, onRemove }: {
  medic: MedicState
  onAssign: (id: string, dest: { lat: number; lng: number; label: string } | null) => void
  onRemove?: (id: string) => void
}) {
  const online = isOnline(medic.lastSeenAt)
  const going = medic.status === 'going_to'
  const offlineMs = Date.now() - new Date(medic.lastSeenAt).getTime()
  const offlineLong = !online && offlineMs > 5 * 60_000

  const initials = medic.name
    .split(' ')
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .join('')

  const dotColor = online ? (going ? '#f59e0b' : '#22c55e') : '#475569'

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.07)' }}
    >
      {/* Avatar */}
      <div
        className="flex items-center justify-center rounded-full font-bold text-xs flex-shrink-0"
        style={{
          width: 34, height: 34,
          background: online ? (going ? 'rgba(245,158,11,0.18)' : 'rgba(34,197,94,0.15)') : 'rgba(71,85,105,0.18)',
          border: `2px solid ${dotColor}`,
          color: dotColor,
          opacity: online ? 1 : 0.6,
        }}
      >
        {initials}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-200 truncate">{medic.name}</span>
          {online && going && (
            <span className="text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1"
              style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}>
              <Navigation className="w-2.5 h-2.5" />
              {medic.destination?.label ?? 'en route'}
            </span>
          )}
        </div>
        <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
          {online
            ? going ? 'Going to ' + (medic.destination?.label ?? '…') : 'Available'
            : `Last seen ${msToLabel(Date.now() - new Date(medic.lastSeenAt).getTime())}`
          }
        </div>
      </div>

      {/* Status dot */}
      <div
        className="flex-shrink-0 rounded-full"
        style={{ width: 8, height: 8, background: dotColor, opacity: online ? 1 : 0.45 }}
      />

      {/* Clear assignment button */}
      {online && going && (
        <button
          onClick={() => onAssign(medic.medicId, null)}
          className="text-xs px-2 py-1 rounded-lg flex-shrink-0 transition-colors"
          style={{ background: 'rgba(100,116,139,0.12)', color: '#64748b', border: '1px solid rgba(100,116,139,0.15)' }}
          title="Clear assignment"
        >
          ✕
        </button>
      )}

      {/* Remove offline medic button (offline >5 min) */}
      {offlineLong && onRemove && (
        <button
          onClick={() => onRemove(medic.medicId)}
          className="text-xs px-2 py-1 rounded-lg flex-shrink-0 transition-colors"
          style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
          title="Remove from active list"
        >
          Remove
        </button>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: event, isLoading, isError } = useEvent(id)
  const activate = useActivateEvent()
  const [activeTab, setActiveTab] = useState<'info' | 'medics' | 'incidents'>('info')
  const [showTracks, setShowTracks] = useState(true)
  const [showMedics, setShowMedics] = useState(true)
  const [showPois, setShowPois] = useState(true)
  const [showParticipants, setShowParticipants] = useState(false)
  const [showIncidents, setShowIncidents] = useState(true)
  // -1 = All days, 0+ = specific day index
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(-1)
  const [showQR, setShowQR] = useState(false)
  const [addPoiCoords, setAddPoiCoords] = useState<[number, number] | null>(null)
  const [addPoiType, setAddPoiType] = useState<POIType>('medical-point')
  const [addPoiName, setAddPoiName] = useState('')
  const [localExtraPois, setLocalExtraPois] = useState<PointOfInterest[]>([])

  const isActive = event?.status === 'active'
  const { medics, runners, incidents: liveIncidents, connected, assignDestination, removeActiveMedic, assignIncident } = useLiveMap({ eventId: id, enabled: isActive })

  // Fetch GPX coordinates for each discipline that has a gpxUrl
  const [gpxCoords, setGpxCoords] = useState<Record<string, [number, number][]>>({})
  useEffect(() => {
    if (!event) return
    const disciplines = (event.days ?? []).flatMap(d => d.disciplines ?? [])
    const toFetch = disciplines.filter(d => d.gpxUrl)
    if (toFetch.length === 0) return

    let cancelled = false
    Promise.all(
      toFetch.map(async d => {
        const coords = await fetchGpxCoordinates(d.gpxUrl!)
        return { key: d.gpxUrl!, coords }
      })
    ).then(results => {
      if (cancelled) return
      const map: Record<string, [number, number][]> = {}
      results.forEach(r => { map[r.key] = r.coords })
      setGpxCoords(map)
    })
    return () => { cancelled = true }
  }, [event?.id])

  const allPois = (event?.days || []).flatMap(d => d.pois || [])
  const allAssignments = (event?.days || []).flatMap(d => d.assignments || [])

  // Day-filtered days list
  const eventDays = event?.days || []
  const filteredDays = selectedDayIdx >= 0 ? [eventDays[selectedDayIdx]].filter(Boolean) : eventDays

  const allTracks = filteredDays.flatMap((day) =>
    (day.disciplines || []).map(disc => ({
      id: `${day.date}-${disc.name}`,
      name: disc.name,
      color: disc.color,
      coordinates: (disc.gpxUrl ? gpxCoords[disc.gpxUrl] : undefined) ?? [],
    }))
  )

  const filteredPois = filteredDays.flatMap(d => d.pois || [])

  const mapPois = [
    ...filteredPois.map((p, i) => ({
      id: `poi-${i}`,
      type: p.type as any,
      coordinates: [p.lng, p.lat] as [number, number],
      name: p.name,
    })),
    ...localExtraPois,
  ]

  function handleAddPoi() {
    if (!addPoiCoords) return
    const newPoi: PointOfInterest = {
      id: `local-${Date.now()}`,
      type: addPoiType,
      coordinates: addPoiCoords,
      name: addPoiName.trim() || undefined,
    }
    setLocalExtraPois(prev => [...prev, newPoi])
  }

  const mapFitBounds = useMemo(() => {
    const coords: [number, number][] = [
      ...allTracks.flatMap(t => t.coordinates),
      ...mapPois.map(p => p.coordinates),
    ]
    if (coords.length === 0) return undefined
    const lngs = coords.map(c => c[0])
    const lats = coords.map(c => c[1])
    return [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ] as [[number, number], [number, number]]
  }, [allTracks, mapPois])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'rgba(34,197,94,0.3)', borderTopColor: '#22c55e' }} />
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

  const status = STATUS_CONFIG[event.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft
  const totalDiscs = (event.days || []).reduce((s, d) => s + (d.disciplines || []).length, 0)
  const totalPois = allPois.length
  const medicalPois = allPois.filter(p => POI_CONFIGS.find(c => c.type === p.type)?.category === 'medical').length

  const onlineMedics = medics.filter(m => isOnline(m.lastSeenAt))
  const offlineMedics = medics.filter(m => !isOnline(m.lastSeenAt))

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      {/* Header */}
      <div
        className="flex items-center justify-between px-8 py-4 flex-shrink-0"
        style={{
          borderBottom: '1px solid rgba(148,163,184,0.08)',
          background: 'rgba(10,20,36,0.9)',
          backdropFilter: 'blur(12px)',
          position: 'sticky', top: 0, zIndex: 10,
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
          {/* WS connection badge (active events only) */}
          {isActive && (
            <div
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{
                background: connected ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.1)',
                border: `1px solid ${connected ? 'rgba(34,197,94,0.25)' : 'rgba(100,116,139,0.2)'}`,
                color: connected ? '#22c55e' : '#64748b',
              }}
            >
              {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {connected ? 'Live' : 'Reconnecting…'}
            </div>
          )}
          {/* QR Code button */}
          <button
            onClick={() => setShowQR(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#22c55e' }}
            title="Show join QR code"
          >
            <QrCode className="w-4 h-4" />
          </button>
          {event.status === 'draft' && (
            <Link
              href={`/events/create?edit=${id}`}
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
        {/* Left panel */}
        <div
          className="w-[400px] flex-shrink-0 flex flex-col h-full"
          style={{ borderRight: '1px solid rgba(148,163,184,0.08)', background: 'rgba(10,18,34,0.6)' }}
        >
          {/* Day selector tab strip — only when event has >1 day */}
          {eventDays.length > 1 && (
            <div
              className="flex gap-1.5 px-3 py-2 border-b overflow-x-auto"
              style={{ borderColor: 'rgba(148,163,184,0.08)', scrollbarWidth: 'none' }}
            >
              {/* All tab */}
              <button
                onClick={() => setSelectedDayIdx(-1)}
                className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold relative transition-colors"
                style={{
                  background: selectedDayIdx === -1 ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${selectedDayIdx === -1 ? 'rgba(34,197,94,0.35)' : 'rgba(148,163,184,0.1)'}`,
                  color: selectedDayIdx === -1 ? '#22c55e' : '#64748b',
                }}
              >
                All
              </button>
              {eventDays.map((day, i) => {
                const d = new Date(day.date)
                const shortDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                const isSelected = selectedDayIdx === i
                return (
                  <button
                    key={day.date}
                    onClick={() => setSelectedDayIdx(i)}
                    className="flex-shrink-0 flex flex-col items-center px-3 py-1 rounded-full text-xs font-semibold transition-colors"
                    style={{
                      background: isSelected ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${isSelected ? 'rgba(34,197,94,0.35)' : 'rgba(148,163,184,0.1)'}`,
                      color: isSelected ? '#22c55e' : '#64748b',
                    }}
                  >
                    <span>Day {i + 1}</span>
                    <span className="text-[9px] font-normal opacity-75">{shortDate}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Tab bar */}
          <div className="flex border-b" style={{ borderColor: 'rgba(148,163,184,0.08)' }}>
            {(['info', 'medics', 'incidents'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="flex-1 py-3 text-xs font-semibold uppercase tracking-widest transition-colors relative"
                style={{
                  color: activeTab === tab ? '#e2e8f0' : '#475569',
                  background: 'transparent',
                }}
              >
                {tab === 'medics' && isActive && medics.length > 0 && (
                  <span
                    className="absolute top-2 right-1/4 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black"
                    style={{ background: onlineMedics.length > 0 ? '#22c55e' : '#475569', color: '#fff' }}
                  >
                    {onlineMedics.length}
                  </span>
                )}
                {tab === 'incidents' && isActive && liveIncidents.filter(i => i.status === 'open').length > 0 && (
                  <span
                    className="absolute top-2 right-1/4 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black"
                    style={{ background: '#ef4444', color: '#fff' }}
                  >
                    {liveIncidents.filter(i => i.status === 'open').length}
                  </span>
                )}
                {tab}
                {activeTab === tab && (
                  <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full" style={{ background: '#22c55e' }} />
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* ── INFO TAB ── */}
            {activeTab === 'info' && (
              <div className="p-6 space-y-5">
                {event.imageUrl && (
                  <div className="rounded-2xl overflow-hidden h-40">
                    <img src={event.imageUrl} alt={event.title} className="w-full h-full object-cover" />
                  </div>
                )}
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
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {medicalPois > 0 && (
                  <div>
                    <div className="text-xs font-semibold mb-3" style={{ color: '#64748b' }}>MEDICAL COVERAGE</div>
                    <div className="grid grid-cols-2 gap-2">
                      {POI_CONFIGS.filter(c => c.category === 'medical').map(config => {
                        const count = allPois.filter(p => p.type === config.type).length
                        if (count === 0) return null
                        return (
                          <div key={config.type} className="flex items-center gap-2.5 p-3 rounded-xl"
                            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.06)' }}>
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                              style={{ background: config.bg, color: config.color }}>
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

                {/* Live participant tracking card */}
                {isActive && (
                  <div className="rounded-2xl p-4" style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ background: runners.length > 0 ? '#f97316' : '#475569', ...(runners.length > 0 ? { animation: 'pulse 2s infinite' } : {}) }} />
                        <span className="text-xs font-bold" style={{ color: '#f97316' }}>LIVE PARTICIPANTS</span>
                      </div>
                      <span className="text-2xl font-black" style={{ color: runners.length > 0 ? '#f97316' : '#475569' }}>{runners.length}</span>
                    </div>
                    <p className="text-xs" style={{ color: '#64748b' }}>
                      {runners.length > 0
                        ? 'GPS positions updating live. Toggle "Heatmap" in the layer panel to visualise.'
                        : 'No participants transmitting yet. Positions will appear when runners join.'}
                    </p>
                  </div>
                )}

                {event.status === 'draft' && (
                  <div className="flex items-start gap-3 p-4 rounded-2xl"
                    style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    <Play className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
                    <div className="text-xs" style={{ color: '#94a3b8' }}>
                      This event is in <span className="font-semibold text-amber-400">Draft</span> mode. Click{' '}
                      <span className="font-semibold text-amber-400">Activate Event</span> to go live.{' '}
                      Join code: <span className="font-mono font-bold text-amber-400">{event.id}</span>.
                    </div>
                  </div>
                )}

                {event.status === 'active' && (
                  <div className="flex items-start gap-3 p-4 rounded-2xl"
                    style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
                    <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 animate-pulse" style={{ background: '#22c55e' }} />
                    <div className="text-xs" style={{ color: '#94a3b8' }}>
                      Event is <span className="font-semibold text-green-400">Live</span>. Join code:{' '}
                      <span className="font-mono font-bold text-green-400">{event.id}</span>.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── MEDICS TAB ── */}
            {/* ── INCIDENTS TAB ── */}
            {activeTab === 'incidents' && (
              <div className="p-4 space-y-3">
                {liveIncidents.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <AlertTriangle className="w-10 h-10" style={{ color: '#334155' }} />
                    <div className="text-sm font-semibold text-slate-500">No incidents reported</div>
                    <div className="text-xs" style={{ color: '#475569' }}>
                      Incidents reported by medics during the event will appear here.
                    </div>
                  </div>
                ) : (
                  liveIncidents.map(inc => (
                    <div
                      key={inc.id}
                      className="rounded-xl px-4 py-3 flex items-start gap-3"
                      style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}
                    >
                      <div
                        className="flex items-center justify-center rounded-full font-black flex-shrink-0 mt-0.5"
                        style={{ width: 28, height: 28, background: 'rgba(239,68,68,0.18)', color: '#f87171', fontSize: 14 }}
                      >
                        !
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-200 capitalize">{inc.type ?? 'Incident'}</span>
                          <span
                            className="text-xs font-semibold px-2 py-0.5 rounded-full capitalize"
                            style={{
                              background: inc.status === 'resolved' ? 'rgba(34,197,94,0.12)' : inc.status === 'in_progress' ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)',
                              color: inc.status === 'resolved' ? '#22c55e' : inc.status === 'in_progress' ? '#f59e0b' : '#f87171',
                            }}
                          >
                            {inc.status.replace('_', ' ')}
                          </span>
                        </div>
                        {inc.description && (
                          <div className="text-xs mt-1" style={{ color: '#94a3b8' }}>{inc.description}</div>
                        )}
                        <div className="text-xs mt-1" style={{ color: '#475569' }}>
                          {inc.lat.toFixed(5)}, {inc.lng.toFixed(5)} · {msToLabel(Date.now() - new Date(inc.createdAt).getTime())}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'medics' && (
              <div className="p-4 space-y-4">
                {!isActive ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <Users className="w-10 h-10" style={{ color: '#334155' }} />
                    <div className="text-sm font-semibold text-slate-500">Medics go live when the event is activated</div>
                  </div>
                ) : medics.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <User className="w-10 h-10" style={{ color: '#334155' }} />
                    <div className="text-sm font-semibold text-slate-500">No medics have joined yet</div>
                    <div className="text-xs" style={{ color: '#475569' }}>
                      Medics join from the mobile app using event code{' '}
                      <span className="font-mono text-green-500">{event.id}</span>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Online medics */}
                    {onlineMedics.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold mb-2 flex items-center gap-2"
                          style={{ color: '#64748b' }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                          ONLINE · {onlineMedics.length}
                        </div>
                        <div className="space-y-2">
                          {onlineMedics.map(m => (
                            <MedicRow key={m.medicId} medic={m} onAssign={assignDestination} onRemove={removeActiveMedic} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Offline medics */}
                    {offlineMedics.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold mb-2 flex items-center gap-2"
                          style={{ color: '#64748b' }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-600 inline-block" />
                          LAST SEEN · {offlineMedics.length}
                        </div>
                        <div className="space-y-2">
                          {offlineMedics.map(m => (
                            <MedicRow key={m.medicId} medic={m} onAssign={assignDestination} onRemove={removeActiveMedic} />
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          <MapWrapper
            center={[23.3219, 42.6977]}
            zoom={11}
            pois={showPois ? mapPois : []}
            tracks={showTracks ? allTracks : []}
            liveMedics={isActive && showMedics ? medics : []}
            onMedicAssign={assignDestination}
            runnerLocations={isActive ? runners : []}
            showHeatmap={showParticipants}
            fitBounds={mapFitBounds}
            liveIncidents={isActive && showIncidents ? liveIncidents : []}
            onAssignIncident={isActive ? assignIncident : undefined}
            availableMedics={onlineMedics.map(m => ({ medicId: m.medicId, name: m.name }))}
            availablePois={mapPois}
            onAddPoi={setAddPoiCoords}
          />

          {/* Layer toggles — top right */}
          <div
            className="absolute top-4 right-4 flex flex-col gap-2"
            style={{ zIndex: 10 }}
          >
            {/* Live medics badge when active */}
            {isActive && onlineMedics.length > 0 && (
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl self-end"
                style={{
                  background: 'rgba(10,18,34,0.92)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(34,197,94,0.2)',
                }}
              >
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#22c55e' }} />
                <span className="text-xs font-bold" style={{ color: '#22c55e' }}>
                  {onlineMedics.length} live
                </span>
              </div>
            )}

            {/* Toggle chips */}
            <div
              className="flex flex-col gap-1.5"
              style={{
                background: 'rgba(10,18,34,0.92)',
                backdropFilter: 'blur(12px)',
                borderRadius: 14,
                border: '1px solid rgba(148,163,184,0.12)',
                padding: '10px 12px',
              }}
            >
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#334155' }}>
                <Layers className="w-3 h-3 inline mr-1" />Layers
              </div>
              {[
                { key: 'tracks', label: 'Tracks', count: allTracks.filter(t => t.coordinates.length > 0).length, color: '#3b82f6', active: showTracks, toggle: () => setShowTracks(v => !v) },
                { key: 'medics', label: 'Medics', count: medics.length, color: '#22c55e', active: showMedics, toggle: () => setShowMedics(v => !v) },
                { key: 'pois', label: 'POIs', count: totalPois, color: '#ef4444', active: showPois, toggle: () => setShowPois(v => !v) },
                { key: 'participants', label: 'Heatmap', count: runners.length, color: '#f97316', active: showParticipants, toggle: () => setShowParticipants(v => !v) },
                { key: 'incidents', label: 'Incidents', count: liveIncidents.length, color: '#f87171', active: showIncidents, toggle: () => setShowIncidents(v => !v) },
              ].map(({ key, label, count, color, active, toggle }) => (
                <button
                  key={key}
                  onClick={toggle}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-all text-left w-full"
                  style={{
                    background: active ? `${color}18` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${active ? color + '40' : 'rgba(148,163,184,0.08)'}`,
                    opacity: count === 0 && key !== 'participants' && key !== 'incidents' ? 0.4 : 1,
                  }}
                >
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: active ? color : '#334155' }} />
                  <span className="flex-1 text-xs font-medium" style={{ color: active ? '#e2e8f0' : '#475569' }}>
                    {label}
                  </span>
                  {count > 0 ? (
                    <span
                      className="text-[10px] font-bold"
                      style={{
                        color: active
                          ? (key === 'participants' && count > 0 ? '#f97316' : color)
                          : '#475569'
                      }}
                    >
                      {count}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          {/* Live participant stats — shown when heatmap is active */}
          {isActive && showParticipants && runners.length > 0 && (
            <div
              className="absolute top-4 left-4 flex items-center gap-2.5 px-3 py-2 rounded-xl"
              style={{
                background: 'rgba(10,18,34,0.92)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(249,115,22,0.25)',
                zIndex: 10,
              }}
            >
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#f97316' }} />
              <span className="text-xs font-bold" style={{ color: '#f97316' }}>
                {runners.length} on course
              </span>
              <span className="text-[10px]" style={{ color: '#64748b' }}>· live GPS</span>
            </div>
          )}

          {/* POI legend — bottom left */}
          {showPois && totalPois > 0 && (
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
                      <div className="w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold"
                        style={{ background: config.bg, color: config.color }}>
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

      {/* QR Code Modal */}
      {showQR && <QRModal eventId={event.id} onClose={() => setShowQR(false)} />}

      {/* Add POI Modal */}
      {addPoiCoords && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 50, background: 'rgba(5,10,20,0.82)', backdropFilter: 'blur(14px)' }}
          onClick={() => setAddPoiCoords(null)}
        >
          <div
            className="relative flex flex-col gap-4 p-6 rounded-3xl"
            style={{
              maxWidth: 480, width: '90%',
              background: 'rgba(8,15,28,0.97)',
              border: '1px solid rgba(34,197,94,0.2)',
              boxShadow: '0 0 60px rgba(34,197,94,0.08), 0 24px 80px rgba(0,0,0,0.7)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div>
              <div className="text-xs font-bold mb-1" style={{ color: '#64748b', letterSpacing: 1.5 }}>NEW POINT OF INTEREST</div>
              <div className="text-lg font-bold text-slate-100">
                {addPoiCoords[1].toFixed(5)}, {addPoiCoords[0].toFixed(5)}
              </div>
            </div>

            {/* POI type grid */}
            <div>
              <div className="text-xs font-semibold mb-2" style={{ color: '#64748b' }}>SELECT TYPE</div>
              <div className="grid grid-cols-3 gap-2">
                {POI_CONFIGS.map(cfg => (
                  <button
                    key={cfg.type}
                    onClick={() => setAddPoiType(cfg.type as POIType)}
                    style={{
                      padding: '8px 6px', borderRadius: 10, textAlign: 'center',
                      background: addPoiType === cfg.type ? `${cfg.bg}` : 'rgba(255,255,255,0.03)',
                      border: `1.5px solid ${addPoiType === cfg.type ? cfg.color : 'rgba(148,163,184,0.1)'}`,
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    <div className="text-base mb-1">{POI_ICON[cfg.type] ?? '•'}</div>
                    <div className="text-[10px] font-semibold leading-tight" style={{ color: addPoiType === cfg.type ? cfg.color : '#64748b' }}>
                      {cfg.label}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Name input */}
            <input
              placeholder="Name (optional)"
              value={addPoiName}
              onChange={e => setAddPoiName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-200"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.15)', outline: 'none' }}
            />

            <div className="flex gap-3">
              <button
                onClick={() => {
                  handleAddPoi()
                  setAddPoiCoords(null)
                  setAddPoiName('')
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: '#fff', boxShadow: '0 4px 14px rgba(34,197,94,0.35)' }}
              >
                Add POI
              </button>
              <button
                onClick={() => setAddPoiCoords(null)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)', color: '#64748b' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
