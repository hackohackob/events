'use client'

import { use, useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import {
  ChevronRight, Calendar, MapPin, Users, Activity,
  Play, Pause, ArrowLeft, Edit, Wifi, WifiOff, User, Navigation,
  Layers, AlertTriangle, QrCode, X, Megaphone, Moon, Stethoscope, Crown, Pencil, Check, MessageCircle
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEvent, useActivateEvent, useDeactivateEvent } from '@/hooks/useEvents'
import { useLiveMap } from '@/hooks/useLiveMap'
import { useHeatmap } from '@/hooks/useHeatmap'
import MapWrapper from '@/components/map/MapWrapper'
import BroadcastModal from '@/components/BroadcastModal'
import IncidentDrawer from '@/components/IncidentDrawer'
import MedicDrawer from '@/components/MedicDrawer'
import ChatDrawer from '@/components/ChatDrawer'
import { useEventChat } from '@/hooks/useEventChat'
import { POI_CONFIGS } from '@/lib/constants'
import { fetchGpxCoordinates } from '@/lib/gpx'
import { getMedicRoster } from '@/api/medics'
import { updatePoi } from '@/api/events'
import type { EventMedic, MedicState } from '@events/contracts'
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
  return Date.now() - new Date(lastSeenAt).getTime() < 120_000 // 2 min — 4× the 30s send interval
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

function MedicRow({ medic, rosterEntry, onAssign, onRemove }: {
  medic: MedicState
  rosterEntry?: EventMedic
  onAssign: (id: string, dest: { lat: number; lng: number; label: string } | null) => void
  onRemove?: (id: string) => void
}) {
  const online = isOnline(medic.lastSeenAt)
  const going = medic.status === 'going_to'
  const resting = medic.status === 'rest'
  const offlineMs = Date.now() - new Date(medic.lastSeenAt).getTime()
  const offlineLong = !online && offlineMs > 5 * 60_000
  const isCoordinator = rosterEntry?.type === 'coordinator'
  const skills = [...(rosterEntry?.skills ?? []), ...(rosterEntry?.capabilities ?? [])]

  const initials = medic.name
    .split(' ')
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .join('')

  const dotColor = online ? (going ? '#f59e0b' : resting ? '#8b5cf6' : '#22c55e') : '#475569'

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
          background: online ? (going ? 'rgba(245,158,11,0.18)' : resting ? 'rgba(139,92,246,0.18)' : 'rgba(34,197,94,0.15)') : 'rgba(71,85,105,0.18)',
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
          {isCoordinator && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0"
              style={{ background: 'rgba(234,179,8,0.14)', color: '#eab308', border: '1px solid rgba(234,179,8,0.25)' }}
              title="Coordinator">
              <Crown className="w-2.5 h-2.5" /> Coord
            </span>
          )}
          {online && going && (
            <span className="text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1"
              style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}>
              <Navigation className="w-2.5 h-2.5" />
              {medic.destination?.label ?? 'en route'}
            </span>
          )}
          {online && resting && (
            <span className="text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1"
              style={{ background: 'rgba(139,92,246,0.12)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)' }}>
              <Moon className="w-2.5 h-2.5" /> Rest
            </span>
          )}
        </div>
        <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
          {online
            ? going ? 'Going to ' + (medic.destination?.label ?? '…') : resting ? 'On rest' : 'Available'
            : `Last seen ${msToLabel(Date.now() - new Date(medic.lastSeenAt).getTime())}`
          }
        </div>
        {skills.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {skills.slice(0, 4).map((s, i) => (
              <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-md flex items-center gap-0.5"
                style={{ background: 'rgba(59,130,246,0.1)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.18)' }}>
                <Stethoscope className="w-2 h-2" /> {s}
              </span>
            ))}
          </div>
        )}
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
  const deactivate = useDeactivateEvent()
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
  const [editingPoiId, setEditingPoiId] = useState<string | null>(null)
  const [poiDescDraft, setPoiDescDraft] = useState('')
  const [poiDescOverrides, setPoiDescOverrides] = useState<Record<string, string>>({})

  async function savePoiDescription(poiId: string) {
    const description = poiDescDraft.trim()
    setPoiDescOverrides(prev => ({ ...prev, [poiId]: description }))
    setEditingPoiId(null)
    try {
      await updatePoi(id, poiId, { description })
    } catch {/* keep optimistic value */}
  }

  const isActive = event?.status === 'active'
  const {
    medics, incidents: liveIncidents, incidentMessages, connected,
    alarmSignal, broadcasts, dismissBroadcast,
    assignDestination, removeActiveMedic, assignIncident, unassignIncident,
    resolveIncident, closeIncident, updateIncidentNotes, loadMessages, sendMessage,
  } = useLiveMap({ eventId: id, enabled: isActive })

  // Runner heatmap from one aggregated, polled snapshot (not per-participant WS).
  const { points: heatPoints, count: runnerCount } = useHeatmap(id, isActive)

  const [showBroadcast, setShowBroadcast] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false) // mobile: side panel overlay
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const [selectedMedicId, setSelectedMedicId] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const chat = useEventChat({ eventId: id, enabled: isActive })
  const [roster, setRoster] = useState<EventMedic[]>([])
  const [alarmInc, setAlarmInc] = useState<{ name?: string; type: string } | null>(null)

  // Roster carries skills / capabilities / coordinator type — joined to live medics by id.
  useEffect(() => {
    if (!isActive) return
    getMedicRoster(id).then(setRoster).catch(() => {/* non-critical */})
  }, [id, isActive])
  const rosterById = useMemo(() => {
    const m = new Map<string, EventMedic>()
    roster.forEach(r => m.set(r.id, r))
    return m
  }, [roster])

  // Incident alarm: flash a banner + play a short alert tone when a new incident lands.
  useEffect(() => {
    if (alarmSignal.count === 0 || !alarmSignal.incident) return
    setAlarmInc({ name: alarmSignal.incident.name, type: alarmSignal.incident.type })
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext)
      if (Ctx) {
        const ctx = new Ctx()
        ;[0, 0.28].forEach((offset) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'square'
          osc.frequency.value = 880
          gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset)
          gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + offset + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.22)
          osc.connect(gain); gain.connect(ctx.destination)
          osc.start(ctx.currentTime + offset); osc.stop(ctx.currentTime + offset + 0.24)
        })
      }
    } catch {/* audio not available */}
    const t = setTimeout(() => setAlarmInc(null), 6000)
    return () => clearTimeout(t)
  }, [alarmSignal.count])

  const selectedIncident = liveIncidents.find(i => i.id === selectedIncidentId) ?? null
  const selectedMedic = medics.find(m => m.medicId === selectedMedicId) ?? null

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
    // Fixed viewport height: with min-h the page grew whenever the side panel
    // content (e.g. many POIs) exceeded the viewport, stretching the map.
    <div className="flex flex-col flex-1 h-screen max-h-screen overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 flex-wrap px-4 lg:px-8 py-3 lg:py-4 flex-shrink-0"
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
          {/* Team chat launcher (active events) */}
          {isActive && (
            <button
              onClick={() => { setChatOpen(true); chat.markRead() }}
              className="relative flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399' }}
            >
              <MessageCircle className="w-4 h-4" />
              Chat
              {chat.unread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white" style={{ background: '#ef4444' }}>
                  {chat.unread > 9 ? '9+' : chat.unread}
                </span>
              )}
            </button>
          )}
          {/* Broadcast button (active events) */}
          {isActive && (
            <button
              onClick={() => setShowBroadcast(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b' }}
              title="Broadcast to all medics"
            >
              <Megaphone className="w-4 h-4" /> Broadcast
            </button>
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
          {event.status === 'active' && (
            <button
              onClick={() => deactivate.mutate(id)}
              disabled={deactivate.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-70"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.25)', color: '#cbd5e1' }}
            >
              <Pause className="w-4 h-4" />
              {deactivate.isPending ? 'Deactivating...' : 'Deactivate Event'}
            </button>
          )}
        </div>
      </div>

      {/* Incident alarm banner */}
      {alarmInc && (
        <button
          onClick={() => { setActiveTab('incidents'); setAlarmInc(null) }}
          className="flex items-center gap-3 px-8 py-3 flex-shrink-0 w-full text-left"
          style={{ background: 'rgba(239,68,68,0.16)', borderBottom: '1px solid rgba(239,68,68,0.35)', animation: 'pulse 1.1s infinite' }}
        >
          <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: '#f87171' }} />
          <span className="text-sm font-bold" style={{ color: '#fecaca' }}>
            🚨 {alarmInc.name ?? 'New incident'} reported
          </span>
          <span className="text-xs capitalize" style={{ color: '#f87171' }}>{alarmInc.type}</span>
          <span className="ml-auto text-xs font-semibold" style={{ color: '#fca5a5' }}>View →</span>
        </button>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile backdrop when the panel is open */}
        {panelOpen && (
          <div
            className="absolute inset-0 z-20 lg:hidden"
            style={{ background: 'rgba(2,8,18,0.6)' }}
            onClick={() => setPanelOpen(false)}
          />
        )}
        {/* Left panel — overlay drawer on mobile, fixed sidebar on desktop */}
        <div
          className={`absolute lg:relative inset-y-0 left-0 z-30 w-[88vw] max-w-[380px] lg:max-w-none lg:w-[400px] flex-shrink-0 flex flex-col h-full transition-transform duration-300 ${panelOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
          style={{ borderRight: '1px solid rgba(148,163,184,0.08)', background: 'rgba(8,15,28,0.98)' }}
        >
          {/* Mobile close button */}
          <button
            onClick={() => setPanelOpen(false)}
            className="lg:hidden absolute top-2 right-2 z-10 p-2 rounded-xl"
            style={{ color: '#64748b', background: 'rgba(255,255,255,0.05)' }}
            aria-label="Close panel"
          >
            <X className="w-5 h-5" />
          </button>
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

                {/* Points of interest — editable descriptions (live + draft) */}
                {allPois.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold mb-3" style={{ color: '#64748b' }}>POINTS OF INTEREST</div>
                    <div className="space-y-1.5">
                      {allPois.map((poi: any, i: number) => {
                        const poiId = poi.id ?? `idx-${i}`
                        const desc = poiDescOverrides[poiId] ?? poi.description
                        const editing = editingPoiId === poiId
                        const canEdit = Boolean(poi.id)
                        return (
                          <div key={poiId} className="flex items-start gap-2.5 p-2.5 rounded-xl"
                            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.07)' }}>
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold"
                              style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>
                              {POI_ICON[poi.type] ?? '•'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-slate-200 truncate">
                                  {poi.name || POI_CONFIGS.find(c => c.type === poi.type)?.label || poi.type}
                                </span>
                                {canEdit && !editing && (
                                  <button onClick={() => { setEditingPoiId(poiId); setPoiDescDraft(desc ?? '') }}
                                    className="ml-auto p-1 rounded hover:bg-white/10 flex-shrink-0" title="Edit description">
                                    <Pencil className="w-3 h-3" style={{ color: '#64748b' }} />
                                  </button>
                                )}
                              </div>
                              {editing ? (
                                <div className="flex items-center gap-1.5 mt-1.5">
                                  <input
                                    autoFocus
                                    value={poiDescDraft}
                                    onChange={e => setPoiDescDraft(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') void savePoiDescription(poiId); if (e.key === 'Escape') setEditingPoiId(null) }}
                                    placeholder="Short description…"
                                    className="flex-1 min-w-0 px-2 py-1 rounded-lg text-xs text-slate-100 outline-none"
                                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(34,197,94,0.4)' }}
                                  />
                                  <button onClick={() => void savePoiDescription(poiId)} className="p-1 rounded hover:bg-green-500/20">
                                    <Check className="w-3.5 h-3.5 text-green-400" />
                                  </button>
                                  <button onClick={() => setEditingPoiId(null)} className="p-1 rounded hover:bg-white/10">
                                    <X className="w-3.5 h-3.5 text-slate-500" />
                                  </button>
                                </div>
                              ) : (
                                <div className="text-xs mt-0.5" style={{ color: desc ? '#94a3b8' : '#475569' }}>
                                  {desc || 'No description — click ✎ to add one'}
                                </div>
                              )}
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
                        <div className="w-2 h-2 rounded-full" style={{ background: runnerCount > 0 ? '#f97316' : '#475569', ...(runnerCount > 0 ? { animation: 'pulse 2s infinite' } : {}) }} />
                        <span className="text-xs font-bold" style={{ color: '#f97316' }}>LIVE PARTICIPANTS</span>
                      </div>
                      <span className="text-2xl font-black" style={{ color: runnerCount > 0 ? '#f97316' : '#475569' }}>{runnerCount}</span>
                    </div>
                    <p className="text-xs" style={{ color: '#64748b' }}>
                      {runnerCount > 0
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
                  [...liveIncidents]
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .map(inc => {
                    const resolvedOrClosed = inc.status === 'resolved' || inc.status === 'closed'
                    const statusColor = inc.status === 'resolved' ? '#22c55e' : inc.status === 'closed' ? '#64748b' : inc.status === 'in_progress' || inc.status === 'assigned' ? '#f59e0b' : '#f87171'
                    return (
                    <button
                      key={inc.id}
                      onClick={() => setSelectedIncidentId(inc.id)}
                      className="w-full text-left rounded-xl px-4 py-3 flex items-start gap-3 transition-all hover:brightness-125"
                      style={{
                        background: resolvedOrClosed ? 'rgba(255,255,255,0.03)' : 'rgba(239,68,68,0.07)',
                        border: `1px solid ${resolvedOrClosed ? 'rgba(148,163,184,0.12)' : 'rgba(239,68,68,0.2)'}`,
                      }}
                    >
                      <div
                        className="flex items-center justify-center rounded-full font-black flex-shrink-0 mt-0.5"
                        style={{ width: 28, height: 28, background: `${statusColor}28`, color: statusColor, fontSize: 14 }}
                      >
                        !
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-200 truncate">
                            {inc.name ?? 'Incident'}<span className="font-normal capitalize" style={{ color: '#64748b' }}> · {inc.type}</span>
                          </span>
                          <span
                            className="text-xs font-semibold px-2 py-0.5 rounded-full capitalize flex-shrink-0"
                            style={{ background: `${statusColor}20`, color: statusColor }}
                          >
                            {inc.status.replace('_', ' ')}
                          </span>
                        </div>
                        {inc.description && (
                          <div className="text-xs mt-1 truncate" style={{ color: '#94a3b8' }}>{inc.description}</div>
                        )}
                        <div className="text-xs mt-1" style={{ color: '#475569' }}>
                          {inc.lat.toFixed(5)}, {inc.lng.toFixed(5)} · {msToLabel(Date.now() - new Date(inc.createdAt).getTime())}
                        </div>
                      </div>
                    </button>
                    )
                  })
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
                            <MedicRow key={m.medicId} medic={m} rosterEntry={rosterById.get(m.medicId)} onAssign={assignDestination} onRemove={removeActiveMedic} />
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
                            <MedicRow key={m.medicId} medic={m} rosterEntry={rosterById.get(m.medicId)} onAssign={assignDestination} onRemove={removeActiveMedic} />
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
        <div className="flex-1 relative min-w-0">
          {/* Mobile: open the info/medics/incidents panel */}
          <button
            onClick={() => setPanelOpen(true)}
            className="lg:hidden absolute top-4 left-4 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold"
            style={{ zIndex: 10, background: 'rgba(10,18,34,0.92)', backdropFilter: 'blur(12px)', border: '1px solid rgba(148,163,184,0.18)', color: '#e2e8f0' }}
          >
            <Layers className="w-4 h-4" /> Panel
            {isActive && liveIncidents.filter(i => i.status === 'open').length > 0 && (
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black" style={{ background: '#ef4444', color: '#fff' }}>
                {liveIncidents.filter(i => i.status === 'open').length}
              </span>
            )}
          </button>
          <MapWrapper
            center={[23.3219, 42.6977]}
            zoom={11}
            pois={showPois ? mapPois : []}
            tracks={showTracks ? allTracks : []}
            liveMedics={isActive && showMedics ? medics : []}
            onMedicAssign={assignDestination}
            runnerLocations={isActive ? heatPoints : []}
            showHeatmap={showParticipants}
            fitBounds={mapFitBounds}
            liveIncidents={isActive && showIncidents ? liveIncidents : []}
            onAssignIncident={isActive ? assignIncident : undefined}
            availableMedics={onlineMedics.map(m => ({ medicId: m.medicId, name: m.name }))}
            availablePois={mapPois}
            onAddPoi={setAddPoiCoords}
            onIncidentClick={(id) => { setSelectedMedicId(null); setSelectedIncidentId(id) }}
            onMedicClick={(id) => { setSelectedIncidentId(null); setSelectedMedicId(id) }}
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
                { key: 'participants', label: 'Heatmap', count: runnerCount, color: '#f97316', active: showParticipants, toggle: () => setShowParticipants(v => !v) },
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
          {isActive && showParticipants && runnerCount > 0 && (
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
                {runnerCount} on course
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

      {/* Broadcast composer */}
      {showBroadcast && <BroadcastModal eventId={event.id} onClose={() => setShowBroadcast(false)} />}

      {/* Incident detail drawer (status / chat / close) */}
      {selectedIncident && (
        <IncidentDrawer
          incident={selectedIncident}
          messages={incidentMessages.get(selectedIncident.id) ?? []}
          onClose={() => setSelectedIncidentId(null)}
          onResolve={resolveIncident}
          onCloseIncident={closeIncident}
          onSendMessage={sendMessage}
          loadMessages={loadMessages}
          availableMedics={onlineMedics.map(m => ({ medicId: m.medicId, name: m.name }))}
          onAssignResponder={assignIncident}
          onUnassignResponder={unassignIncident}
          medicNameById={Object.fromEntries(medics.map(m => [m.medicId, m.name]))}
          onUpdateNotes={updateIncidentNotes}
        />
      )}

      {selectedMedic && (
        <MedicDrawer
          medic={selectedMedic}
          incidents={liveIncidents}
          onClose={() => setSelectedMedicId(null)}
          onAssignToIncident={(medicId, incidentId) => assignIncident(incidentId, medicId)}
          onClearDestination={(medicId) => void assignDestination(medicId, null)}
        />
      )}

      {chatOpen && (
        <ChatDrawer
          messages={chat.messages}
          loading={chat.loading}
          onSend={chat.send}
          onClose={() => { setChatOpen(false); chat.setOpen(false) }}
        />
      )}

      {/* Broadcast toasts — stack newest-first, each dismissible */}
      {broadcasts.length > 0 && (
        <div className="fixed bottom-6 right-6 flex flex-col gap-2.5" style={{ zIndex: 40, maxWidth: 'min(92vw, 360px)' }}>
          {broadcasts.map(b => (
            <div
              key={b.id}
              className="flex items-start gap-3 px-4 py-3 rounded-2xl"
              style={{ background: 'rgba(8,15,28,0.97)', border: '1px solid rgba(245,158,11,0.3)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
            >
              <Megaphone className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#f59e0b' }} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-100 truncate">{b.title}</div>
                <div className="text-[11px]" style={{ color: '#94a3b8' }}>{b.body}</div>
                <div className="text-[10px] mt-0.5" style={{ color: '#475569' }}>
                  {new Date(b.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · sent to all medics
                </div>
              </div>
              <button
                onClick={() => dismissBroadcast(b.id)}
                className="p-1 rounded-lg flex-shrink-0 transition-colors"
                style={{ color: '#64748b', background: 'rgba(255,255,255,0.04)' }}
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

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
