'use client'

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, Info, Trash2, Eye, EyeOff, Check, X, Copy, Mountain, TrendingUp } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceDot } from 'recharts'
import MapWrapper from '@/components/map/MapWrapper'
import MapLayersControl from '@/components/map/MapLayersControl'
import type { BaseLayer } from '@/components/map/MapClient'
import type { EventFormData, PointOfInterest, POIType } from '@/lib/types'
import { POI_CONFIGS, MAP_CENTER } from '@/lib/constants'
import { PoiIcon, CUSTOM_POI_ICON_OPTIONS } from '@/lib/poi-icons'
import { computeTrackBounds } from '@/lib/utils'

interface Props {
  data: EventFormData
  update: (p: Partial<EventFormData>) => void
  onNext: () => void
  onBack: () => void
}

/** A POI is considered "on the path" within this distance of the track. */
const POI_ON_PATH_METERS = 200

/** Great-circle distance in metres between two [lng, lat] points. */
function distanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const la1 = toRad(a[1])
  const la2 = toRad(b[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/** POI badge drawn on the elevation profile (Recharts ReferenceDot custom shape):
 *  a circular icon chip with a connector to the elevation line. It sits above the
 *  line, but flips below near the top of the chart so it's never clipped. Hovering
 *  shows the POI's name (native SVG tooltip). */
function PoiProfileMarker({ cx, cy, poi }: { cx?: number; cy?: number; poi: PointOfInterest }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null
  const x = cx as number
  const y = cy as number
  const cfg = POI_CONFIGS.find((c) => c.type === poi.type)
  const color = cfg?.color ?? '#94a3b8'
  const label = poi.name?.trim() || cfg?.label || poi.type
  // Not enough room above the line → drop the badge below the point.
  const below = y < 34
  const lineEnd = below ? y + 12 : y - 12
  const badgeCy = below ? y + 21 : y - 21
  const iconY = below ? y + 15 : y - 27
  return (
    <g style={{ cursor: 'pointer' }}>
      <title>{label}</title>
      <line x1={x} y1={y} x2={x} y2={lineEnd} stroke={color} strokeWidth={1} opacity={0.55} />
      <circle cx={x} cy={badgeCy} r={9} fill="rgba(10,18,34,0.97)" stroke={color} strokeWidth={1.5} />
      <g transform={`translate(${x - 6}, ${iconY}) scale(0.5)`}>
        <PoiIcon type={poi.type} icon={poi.icon} size={24} color={color} strokeWidth={2.4} />
      </g>
      {/* Larger transparent hit area so the name tooltip is easy to trigger. */}
      <circle cx={x} cy={badgeCy} r={13} fill="transparent" />
    </g>
  )
}

/** Compact dropdown of selectable vector icons for a custom point of interest. */
function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = CUSTOM_POI_ICON_OPTIONS.find(o => o.key === value) ?? CUSTOM_POI_ICON_OPTIONS[0]

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div ref={ref} className="relative w-44">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full h-9 px-2.5 rounded-lg flex items-center gap-2 transition-colors"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.18)' }}
      >
        <selected.Icon size={16} color="#22c55e" strokeWidth={2.4} />
        <span className="text-xs text-slate-200 flex-1 text-left">{selected.label}</span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg py-1 shadow-xl"
          style={{ background: '#0f172a', border: '1px solid rgba(148,163,184,0.18)' }}
        >
          {CUSTOM_POI_ICON_OPTIONS.map(opt => {
            const active = value === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => { onChange(opt.key); setOpen(false) }}
                className="w-full px-2.5 py-1.5 flex items-center gap-2 transition-colors hover:bg-white/5"
                style={{ background: active ? 'rgba(34,197,94,0.12)' : 'transparent' }}
              >
                <opt.Icon size={16} color={active ? '#22c55e' : '#cbd5e1'} strokeWidth={2.4} />
                <span className="text-xs flex-1 text-left" style={{ color: active ? '#22c55e' : '#cbd5e1' }}>{opt.label}</span>
                {active && <Check size={13} className="text-green-500" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function PointsOfInterestStep({ data, update, onNext, onBack }: Props) {
  const [selectedDayId, setSelectedDayId] = useState(data.days[0]?.id || '')
  const [map3d, setMap3d] = useState(false)
  const [baseLayer, setBaseLayer] = useState<BaseLayer>('streets')
  const [selectedType, setSelectedType] = useState<POIType | null>(null)
  const [customPoiName, setCustomPoiName] = useState('')
  const [customPoiIcon, setCustomPoiIcon] = useState(CUSTOM_POI_ICON_OPTIONS[0].key)
  const [hiddenTrackIds, setHiddenTrackIds] = useState<Set<string>>(new Set())
  const [editingPoiId, setEditingPoiId] = useState<string | null>(null)
  const [editingPoiName, setEditingPoiName] = useState('')
  const [editingPoiDescription, setEditingPoiDescription] = useState('')
  const [editingPoiIcon, setEditingPoiIcon] = useState<string | undefined>(undefined)
  const [hoverElevIndex, setHoverElevIndex] = useState<number | null>(null)
  const [showAllDays, setShowAllDays] = useState(false)
  const [copyConfirmDayId, setCopyConfirmDayId] = useState<string | null>(null)
  const [profileTrackId, setProfileTrackId] = useState<string | null>(null)

  const selectedDay = data.days.find(d => d.id === selectedDayId) || data.days[0]
  const dayIndex = data.days.findIndex(d => d.id === selectedDayId)
  const multiDay = data.days.length > 1

  const updateDayPois = useCallback((dayId: string, newPois: PointOfInterest[]) => {
    update({ days: data.days.map(d => d.id === dayId ? { ...d, pois: newPois } : d) })
  }, [data.days, update])

  const currentPois = selectedDay?.pois || []
  const allPois = data.days.flatMap(d => d.pois)
  const displayedPois = showAllDays ? allPois : currentPois

  // Build tracks per day
  const dayTracks = useMemo(() => data.days.map((day, i) => ({
    dayId: day.id,
    dayLabel: `Day ${i + 1}`,
    dayDate: day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    tracks: day.disciplines.map(disc => ({
      id: disc.id,
      name: disc.name,
      color: disc.color,
      coordinates: disc.gpxCoordinates?.length ? disc.gpxCoordinates : [],
      elevationProfile: disc.elevationProfile ?? [],
      distance: disc.distance,
      elevation: disc.elevation,
    })).filter(t => t.coordinates.length > 0),
  })), [data.days])

  const selectedDayTracks = dayTracks.find(g => g.dayId === selectedDayId)?.tracks || []
  const allTracks = dayTracks.flatMap(g => g.tracks)

  const visibleTracks = showAllDays ? allTracks : selectedDayTracks

  const profileTrack = profileTrackId ? allTracks.find(t => t.id === profileTrackId) ?? null : null

  // Map the elevation-chart hover index → a coordinate on the track, so a dot
  // follows the cursor along the course (matching the Disciplines step).
  const hoverCoord: [number, number] | undefined =
    hoverElevIndex !== null && profileTrack && profileTrack.coordinates.length > 0 && (profileTrack.elevationProfile?.length ?? 0) > 1
      ? profileTrack.coordinates[
          Math.round((hoverElevIndex / Math.max((profileTrack.elevationProfile?.length ?? 1) - 1, 1)) * (profileTrack.coordinates.length - 1))
        ]
      : undefined

  const visibleTrackIds = useMemo(() => {
    if (visibleTracks.length === 0) return undefined
    return new Set(visibleTracks.filter(t => !hiddenTrackIds.has(t.id)).map(t => t.id))
  }, [visibleTracks, hiddenTrackIds])

  // POIs that sit on the open track's path (within 20 m) → placed on the
  // elevation profile at their distance-along-track / elevation.
  const poisOnProfile = useMemo(() => {
    const coords = profileTrack?.coordinates
    const elev = profileTrack?.elevationProfile
    if (!profileTrack || !coords?.length || !elev || elev.length < 2) return []
    return displayedPois
      .map((poi) => {
        let best = Infinity
        let bi = 0
        for (let i = 0; i < coords.length; i++) {
          const d = distanceMeters(poi.coordinates, coords[i] as [number, number])
          if (d < best) { best = d; bi = i }
        }
        if (best > POI_ON_PATH_METERS) return null
        const frac = coords.length > 1 ? bi / (coords.length - 1) : 0
        const pt = elev[Math.round(frac * (elev.length - 1))] as { distance: number; elevation: number } | undefined
        if (!pt) return null
        return { poi, x: pt.distance, y: pt.elevation }
      })
      .filter((v): v is { poi: PointOfInterest; x: number; y: number } => v !== null)
  }, [profileTrack, displayedPois])

  const trackBounds = useMemo(() => {
    const tracks = visibleTracks.filter(t => !hiddenTrackIds.has(t.id))
    const trackList = tracks.length > 0 ? tracks : (allTracks.length > 0 ? allTracks : [])
    const trackCoords = trackList.flatMap(t => t.coordinates)
    const poiCoords = displayedPois.map(p => p.coordinates)
    const allCoords: [number, number][] = [...trackCoords, ...poiCoords]
    if (allCoords.length === 0) return null
    const lngs = allCoords.map(c => c[0])
    const lats = allCoords.map(c => c[1])
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    return {
      center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2] as [number, number],
      bounds: [[minLng, minLat], [maxLng, maxLat]] as [[number, number], [number, number]],
    }
  }, [visibleTracks, hiddenTrackIds, allTracks, displayedPois])

  const handleMapClick = useCallback((coords: [number, number]) => {
    if (!selectedType || !selectedDay) return
    const newPOI: PointOfInterest = {
      id: `poi-${Date.now()}`,
      type: selectedType,
      coordinates: coords,
      name: selectedType === 'custom' ? (customPoiName.trim() || 'Custom Point') : undefined,
      icon: selectedType === 'custom' ? customPoiIcon : undefined,
    }
    updateDayPois(selectedDay.id, [...currentPois, newPOI])
  }, [selectedType, customPoiName, customPoiIcon, currentPois, selectedDay, updateDayPois])

  const handlePOIMove = useCallback((id: string, coords: [number, number]) => {
    if (!selectedDay) return
    updateDayPois(selectedDay.id, currentPois.map(p => p.id === id ? { ...p, coordinates: coords } : p))
  }, [currentPois, selectedDay, updateDayPois])

  const removePOI = (id: string) => {
    if (!selectedDay) return
    updateDayPois(selectedDay.id, currentPois.filter(p => p.id !== id))
  }

  const startEditPoiName = (poi: PointOfInterest) => {
    const config = POI_CONFIGS.find(c => c.type === poi.type)
    setEditingPoiId(poi.id)
    setEditingPoiName(poi.name || config?.label || '')
    setEditingPoiDescription(poi.description || '')
    setEditingPoiIcon(poi.icon ?? (poi.type === 'custom' ? CUSTOM_POI_ICON_OPTIONS[0].key : undefined))
  }

  const confirmEditPoiName = () => {
    if (!editingPoiId || !selectedDay) return
    updateDayPois(selectedDay.id, currentPois.map(p => p.id === editingPoiId
      ? {
          ...p,
          name: editingPoiName.trim() || p.name,
          description: editingPoiDescription.trim() || undefined,
          icon: p.type === 'custom' ? editingPoiIcon : p.icon,
        }
      : p))
    setEditingPoiId(null)
    setEditingPoiName('')
    setEditingPoiDescription('')
    setEditingPoiIcon(undefined)
  }

  const cancelEditPoiName = () => { setEditingPoiId(null); setEditingPoiName(''); setEditingPoiDescription(''); setEditingPoiIcon(undefined) }

  const copyPoisFromDay = (fromDayId: string) => {
    if (!selectedDay) return
    const fromDay = data.days.find(d => d.id === fromDayId)
    if (!fromDay) return
    const copies = fromDay.pois.map(p => ({ ...p, id: `poi-${Date.now()}-${Math.random().toString(36).slice(2)}` }))
    updateDayPois(selectedDay.id, [...currentPois, ...copies])
    setCopyConfirmDayId(null)
  }

  const toggleTrack = (trackId: string) => {
    setHiddenTrackIds(prev => {
      const next = new Set(prev)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      return next
    })
  }

  const poiCounts = POI_CONFIGS.reduce<Record<string, number>>((acc, config) => {
    acc[config.type] = currentPois.filter(p => p.type === config.type).length
    return acc
  }, {})

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div
        className="w-[320px] flex-shrink-0 flex flex-col h-full"
        style={{ borderRight: '1px solid rgba(148,163,184,0.08)', background: 'rgba(10,18,34,0.6)' }}
      >
        {/* Day tabs */}
        {multiDay && (
          <div
            className="flex-shrink-0 flex gap-1 p-3 pb-0 overflow-x-auto"
            style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}
          >
            {data.days.map((day, i) => {
              const isActive = day.id === selectedDayId
              const poiCount = day.pois.length
              return (
                <button
                  key={day.id}
                  onClick={() => { setSelectedDayId(day.id); setSelectedType(null) }}
                  className="flex-shrink-0 flex flex-col items-center gap-0.5 px-3 pb-2.5 pt-2 rounded-t-xl transition-all"
                  style={{
                    background: isActive ? 'rgba(34,197,94,0.08)' : 'transparent',
                    borderBottom: isActive ? '2px solid #22c55e' : '2px solid transparent',
                    color: isActive ? '#22c55e' : '#64748b',
                  }}
                >
                  <span className="text-xs font-bold">Day {i + 1}</span>
                  <span className="text-[10px]">{day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  {poiCount > 0 && (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                    >
                      {poiCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Header */}
          <div>
            <h2 className="text-base font-bold text-slate-100 mb-0.5">Points of Interest</h2>
            <p className="text-xs" style={{ color: '#64748b' }}>
              {multiDay ? `Adding POIs for Day ${dayIndex + 1} — ${selectedDay?.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}` : 'Place medical and other important points on the map.'}
            </p>
          </div>

          {/* Copy from another day */}
          {multiDay && data.days.some(d => d.id !== selectedDayId && d.pois.length > 0) && (
            <div>
              <div className="text-xs font-semibold mb-1.5" style={{ color: '#64748b' }}>COPY FROM DAY</div>
              <div className="flex flex-wrap gap-1.5">
                {data.days.filter(d => d.id !== selectedDayId && d.pois.length > 0).map((day, i) => {
                  const idx = data.days.indexOf(day)
                  return (
                    <button
                      key={day.id}
                      onClick={() => setCopyConfirmDayId(copyConfirmDayId === day.id ? null : day.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={{
                        background: copyConfirmDayId === day.id ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.05)',
                        border: copyConfirmDayId === day.id ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(148,163,184,0.1)',
                        color: copyConfirmDayId === day.id ? '#22c55e' : '#94a3b8',
                      }}
                    >
                      <Copy className="w-3 h-3" />
                      Day {idx + 1} ({day.pois.length})
                    </button>
                  )
                })}
              </div>
              {copyConfirmDayId && (
                <div
                  className="mt-2 p-2.5 rounded-xl flex items-center justify-between gap-2"
                  style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}
                >
                  <span className="text-xs text-slate-300">Copy {data.days.find(d => d.id === copyConfirmDayId)?.pois.length} POIs?</span>
                  <div className="flex gap-1.5">
                    <button onClick={() => copyPoisFromDay(copyConfirmDayId)} className="p-1 rounded hover:bg-green-500/20">
                      <Check className="w-3.5 h-3.5 text-green-400" />
                    </button>
                    <button onClick={() => setCopyConfirmDayId(null)} className="p-1 rounded hover:bg-white/10">
                      <X className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* POI type selector */}
          <div>
            <div className="text-xs font-semibold mb-2" style={{ color: '#64748b' }}>ADD POINT</div>
            <div className="space-y-1">
              {POI_CONFIGS.map(config => (
                <button
                  key={config.type}
                  onClick={() => setSelectedType(t => t === config.type ? null : config.type as POIType)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl transition-all text-left group"
                  style={{
                    background: selectedType === config.type ? `${config.color}15` : 'rgba(255,255,255,0.03)',
                    border: selectedType === config.type ? `1px solid ${config.color}50` : '1px solid rgba(148,163,184,0.08)',
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background: config.bg,
                      boxShadow: selectedType === config.type ? `0 0 12px ${config.color}40` : 'none',
                    }}
                  >
                    <PoiIcon type={config.type} size={17} color={config.color} />
                  </div>
                  <span className="flex-1 font-medium text-sm" style={{ color: selectedType === config.type ? '#f1f5f9' : '#94a3b8' }}>
                    {config.label}
                  </span>
                  {(poiCounts[config.type] || 0) > 0 && (
                    <span
                      className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: `${config.color}20`, color: config.color }}
                    >
                      {poiCounts[config.type]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {selectedType === 'custom' && (
              <div className="mt-2 space-y-2">
                <input
                  value={customPoiName}
                  onChange={e => setCustomPoiName(e.target.value)}
                  placeholder="Custom point name..."
                  className="w-full px-3 py-2 rounded-xl text-sm text-slate-100 outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(148,163,184,0.2)' }}
                />
                <div className="text-[10px] font-semibold" style={{ color: '#64748b' }}>ICON</div>
                <IconPicker value={customPoiIcon} onChange={setCustomPoiIcon} />
              </div>
            )}
          </div>

          {/* Instruction tip */}
          {selectedType ? (
            <div
              className="flex items-start gap-2 p-3 rounded-xl"
              style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}
            >
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#22c55e' }} />
              <span className="text-xs" style={{ color: '#94a3b8' }}>
                <span className="font-semibold text-slate-300">{POI_CONFIGS.find(c => c.type === selectedType)?.label} selected.</span>{' '}
                Click on the map to place. Drag to reposition.
              </span>
            </div>
          ) : (
            <div
              className="flex items-start gap-2 p-3 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.08)' }}
            >
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#64748b' }} />
              <span className="text-xs" style={{ color: '#64748b' }}>Select a point type above, then click the map to place it.</span>
            </div>
          )}

          {/* Placed POIs for this day */}
          {currentPois.length > 0 && (
            <div>
              <div className="text-xs font-semibold mb-2" style={{ color: '#64748b' }}>
                {multiDay ? `DAY ${dayIndex + 1} POINTS (${currentPois.length})` : `PLACED POINTS (${currentPois.length})`}
              </div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {currentPois.map(poi => {
                  const config = POI_CONFIGS.find(c => c.type === poi.type)
                  const isEditing = editingPoiId === poi.id
                  return (
                    <div
                      key={poi.id}
                      className="flex items-center gap-2.5 p-2 rounded-xl group"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.06)' }}
                    >
                      <div
                        className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: config?.bg || '#1e293b' }}
                      >
                        <PoiIcon type={poi.type} icon={poi.icon} size={13} color={config?.color || '#fff'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1">
                              <input
                                autoFocus
                                value={editingPoiName}
                                onChange={e => setEditingPoiName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') confirmEditPoiName(); if (e.key === 'Escape') cancelEditPoiName() }}
                                placeholder="Name"
                                className="flex-1 min-w-0 px-1.5 py-0.5 rounded text-xs text-slate-100 outline-none"
                                style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(34,197,94,0.4)' }}
                              />
                              <button onClick={confirmEditPoiName} className="p-0.5 rounded hover:bg-green-500/20">
                                <Check className="w-3 h-3 text-green-400" />
                              </button>
                              <button onClick={cancelEditPoiName} className="p-0.5 rounded hover:bg-white/10">
                                <X className="w-3 h-3 text-slate-500" />
                              </button>
                            </div>
                            <textarea
                              value={editingPoiDescription}
                              onChange={e => setEditingPoiDescription(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Escape') cancelEditPoiName() }}
                              placeholder="Short description (optional)…"
                              rows={2}
                              className="w-full px-1.5 py-1 rounded text-[11px] text-slate-200 outline-none resize-none"
                              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(148,163,184,0.2)' }}
                            />
                            {poi.type === 'custom' && (
                              <IconPicker value={editingPoiIcon ?? CUSTOM_POI_ICON_OPTIONS[0].key} onChange={setEditingPoiIcon} />
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => startEditPoiName(poi)}
                            className="text-xs font-medium text-slate-300 truncate text-left w-full hover:text-slate-100 transition-colors"
                          >
                            {poi.name || config?.label || poi.type}
                          </button>
                        )}
                        {!isEditing && (
                          <div className="text-[10px]" style={{ color: '#475569' }}>
                            {poi.description
                              ? poi.description
                              : `${poi.coordinates[0].toFixed(4)}, ${poi.coordinates[1].toFixed(4)}`}
                          </div>
                        )}
                      </div>
                      {!isEditing && (
                        <button
                          onClick={() => removePOI(poi.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-slate-500 hover:text-red-400" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Track visibility */}
          {selectedDayTracks.length > 0 && (
            <div>
              <div className="text-xs font-semibold mb-2" style={{ color: '#64748b' }}>TRACKS</div>
              <div className="space-y-1">
                {selectedDayTracks.map(track => {
                  const visible = !hiddenTrackIds.has(track.id)
                  const hasProfile = (track.elevationProfile?.length ?? 0) > 1
                  const profileOpen = profileTrackId === track.id
                  return (
                    <div
                      key={track.id}
                      className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-xl transition-all"
                      style={{
                        background: visible ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${profileOpen ? track.color + '70' : visible ? track.color + '40' : 'rgba(148,163,184,0.06)'}`,
                        opacity: visible ? 1 : 0.5,
                      }}
                    >
                      <button onClick={() => toggleTrack(track.id)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: track.color }} />
                        <div className="flex-1 text-xs font-medium text-slate-300 truncate">{track.name}</div>
                        {visible ? <Eye className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#64748b' }} /> : <EyeOff className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#475569' }} />}
                      </button>
                      {hasProfile && (
                        <button
                          onClick={() => setProfileTrackId(profileOpen ? null : track.id)}
                          title="Show elevation profile"
                          className="p-1 rounded-lg flex-shrink-0 transition-all"
                          style={{
                            background: profileOpen ? track.color + '22' : 'transparent',
                            color: profileOpen ? track.color : '#64748b',
                          }}
                        >
                          <TrendingUp className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="p-4 pt-0 flex-shrink-0" style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}>
          <div className="flex gap-2.5">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.15)', color: '#94a3b8' }}
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={onNext}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', boxShadow: '0 4px 14px rgba(34,197,94,0.3)' }}
            >
              Next Step <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Right: Map + summary */}
      <div className="flex-1 flex flex-col h-full">
        {/* Show all days toggle */}
        {multiDay && (
          <div
            className="flex items-center justify-end px-4 py-2 flex-shrink-0"
            style={{ borderBottom: '1px solid rgba(148,163,184,0.06)', background: 'rgba(10,18,34,0.6)' }}
          >
            <button
              onClick={() => setShowAllDays(v => !v)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: showAllDays ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.05)',
                border: showAllDays ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(148,163,184,0.1)',
                color: showAllDays ? '#22c55e' : '#64748b',
              }}
            >
              {showAllDays ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {showAllDays ? 'Showing all days' : 'Show all days'}
            </button>
          </div>
        )}

        <div className="flex-1 relative min-h-0">
          <MapWrapper
            center={trackBounds?.center || MAP_CENTER}
            zoom={12}
            baseLayer={baseLayer}
            enable3d={map3d}
            pois={displayedPois}
            tracks={visibleTracks}
            visibleTrackIds={visibleTrackIds}
            interactivePOI
            selectedPOIType={selectedType}
            onMapClick={handleMapClick}
            onPOIMove={handlePOIMove}
            fitBounds={trackBounds?.bounds}
            hoverCoord={hoverCoord}
            hoverCoordColor={profileTrack?.color || '#f97316'}
          />
          <MapLayersControl baseLayer={baseLayer} onBaseLayer={setBaseLayer} map3d={map3d} onToggle3d={() => setMap3d(v => !v)} />
        </div>

        {/* Elevation profile panel (toggled from the TRACKS list) */}
        {profileTrack && (profileTrack.elevationProfile?.length ?? 0) > 1 && (
          <div
            className="h-[150px] flex-shrink-0 p-4"
            style={{ background: 'rgba(10,18,34,0.95)', borderTop: '1px solid rgba(148,163,184,0.08)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Mountain className="w-3.5 h-3.5" style={{ color: profileTrack.color }} />
                <span className="text-xs font-medium text-slate-300">Elevation Profile — {profileTrack.name}</span>
                <span className="text-xs" style={{ color: '#64748b' }}>
                  {Math.round(profileTrack.elevation).toLocaleString()} m gain · {profileTrack.distance} km
                </span>
              </div>
              <button
                onClick={() => setProfileTrackId(null)}
                className="p-1 rounded-lg hover:bg-white/10 transition-colors"
                title="Hide elevation profile"
              >
                <X className="w-3.5 h-3.5" style={{ color: '#64748b' }} />
              </button>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={profileTrack.elevationProfile}
                margin={{ top: 0, right: 0, bottom: 12, left: 0 }}
                onMouseMove={(state: { activeTooltipIndex?: number }) => {
                  if (state?.activeTooltipIndex !== undefined && state.activeTooltipIndex !== null) {
                    setHoverElevIndex(state.activeTooltipIndex)
                  }
                }}
                onMouseLeave={() => setHoverElevIndex(null)}
              >
                <defs>
                  <linearGradient id="poiElevGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={profileTrack.color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={profileTrack.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="distance" type="number" domain={['dataMin', 'dataMax']} hide />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(10,20,36,0.95)',
                    border: '1px solid rgba(148,163,184,0.15)',
                    borderRadius: '10px',
                    fontSize: '11px',
                    color: '#f1f5f9',
                  }}
                  formatter={(v: number) => [`${v} m`, 'Elevation']}
                  labelFormatter={(l: number) => `${Number(l).toFixed(1)} km`}
                />
                <Area
                  type="linear"
                  dataKey="elevation"
                  stroke={profileTrack.color}
                  strokeWidth={1.5}
                  fill="url(#poiElevGrad)"
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{ r: 4, fill: profileTrack.color, stroke: 'white', strokeWidth: 2 }}
                />
                {poisOnProfile.map(({ poi, x, y }) => (
                  <ReferenceDot
                    key={poi.id}
                    x={x}
                    y={y}
                    r={0}
                    isFront
                    ifOverflow="extendDomain"
                    shape={(props: { cx?: number; cy?: number }) => (
                      <PoiProfileMarker cx={props.cx} cy={props.cy} poi={poi} />
                    )}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* POI summary bar */}
        <div
          className="flex items-center gap-4 px-6 py-3 flex-shrink-0 overflow-x-auto"
          style={{ background: 'rgba(10,18,34,0.95)', borderTop: '1px solid rgba(148,163,184,0.08)' }}
        >
          {multiDay && (
            <div className="flex items-center gap-2 mr-2 flex-shrink-0">
              <span className="text-xs font-semibold" style={{ color: '#22c55e' }}>Day {dayIndex + 1}</span>
              <div className="w-px h-4" style={{ background: 'rgba(148,163,184,0.15)' }} />
            </div>
          )}
          {POI_CONFIGS.map(config => {
            const count = poiCounts[config.type] || 0
            return (
              <div key={config.type} className="flex flex-col items-center gap-1 min-w-[52px]">
                <div
                  className="w-7 h-7 rounded-xl flex items-center justify-center"
                  style={{ background: config.bg }}
                >
                  <PoiIcon type={config.type} size={15} color={config.color} />
                </div>
                <div className="text-xs font-bold" style={{ color: count > 0 ? '#f1f5f9' : '#475569' }}>{count}</div>
                <div className="text-[9px] text-center leading-tight" style={{ color: '#64748b' }}>
                  {config.label.replace(' Camp', '').replace('Medical ', '').replace(' Point', '').trim()}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
