'use client'

import { useState, useCallback, useMemo } from 'react'
import { Plus, X, Upload, Edit2, Trash2, ChevronLeft, ChevronRight, Mountain, Check, FileText, AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import MapWrapper from '@/components/map/MapWrapper'
import Map3dToggle from '@/components/map/Map3dToggle'
import type { EventFormData, EventDay, Discipline, DisciplineType } from '@/lib/types'
import { DISCIPLINE_COLORS, MAP_CENTER } from '@/lib/constants'
import { generateElevationProfile } from '@/lib/mock-data'
import { computeTrackBounds } from '@/lib/utils'
import { uploadGPX } from '@/api/events'

const DISCIPLINE_ICON_OPTIONS: { type: DisciplineType; emoji: string; label: string }[] = [
  { type: 'trail-run', emoji: '🏃', label: 'Trail Run' },
  { type: 'mtb', emoji: '🚵', label: 'MTB' },
  { type: 'marathon', emoji: '🏅', label: 'Marathon' },
  { type: 'run', emoji: '🤸', label: 'Run' },
  { type: 'bike', emoji: '🚴', label: 'Bike' },
  { type: 'swim', emoji: '🏊', label: 'Swim' },
]

const DISCIPLINE_ICONS: Record<string, string> = Object.fromEntries(
  DISCIPLINE_ICON_OPTIONS.map(o => [o.type, o.emoji])
)

const COLOR_PALETTE = [
  '#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#ec4899', '#14b8a6',
  '#ef4444', '#f59e0b', '#a855f7', '#06b6d4', '#84cc16', '#fb923c',
]

const FALLBACK_TRACK: [number, number][] = [
  [23.322, 42.698], [23.330, 42.706], [23.342, 42.702],
  [23.340, 42.691], [23.328, 42.687], [23.318, 42.693], [23.322, 42.698],
]

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = (b[1] - a[1]) * Math.PI / 180
  const dLon = (b[0] - a[0]) * Math.PI / 180
  const lat1 = a[1] * Math.PI / 180
  const lat2 = b[1] * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(h))
}

interface ParsedGpx {
  coords: [number, number][]
  distanceKm: number
  elevationM: number
  /** Near-raw elevation profile (distance km → elevation m), only lightly smoothed. */
  profile: { distance: number; elevation: number }[]
}

const EMPTY_GPX: ParsedGpx = { coords: [], distanceKm: 0, elevationM: 0, profile: [] }

function parseGPX(text: string): ParsedGpx {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(text, 'text/xml')
    const trkpts = Array.from(doc.querySelectorAll('trkpt'))
    if (trkpts.length === 0) return EMPTY_GPX

    const coords: [number, number][] = trkpts.map(pt => [
      parseFloat(pt.getAttribute('lon') || '0'),
      parseFloat(pt.getAttribute('lat') || '0'),
    ])

    // Cumulative distance per point + raw elevation
    const cumDist: number[] = [0]
    for (let i = 1; i < coords.length; i++) cumDist[i] = cumDist[i - 1] + haversineKm(coords[i - 1], coords[i])
    const distanceKm = cumDist[cumDist.length - 1] ?? 0

    const eles = trkpts.map(pt => parseFloat(pt.querySelector('ele')?.textContent || '0'))
    let elevationM = 0
    for (let i = 1; i < eles.length; i++) {
      const diff = eles[i] - eles[i - 1]
      if (diff > 0) elevationM += diff
    }

    // Build a near-raw profile. Only very light smoothing: a 3-point moving
    // average to take the edge off GPS noise, but otherwise the real GPX shape.
    const hasElevation = eles.some(e => e > 0)
    let profile: { distance: number; elevation: number }[] = []
    if (hasElevation) {
      const smoothed = eles.map((e, i) => {
        if (i === 0 || i === eles.length - 1) return e
        return (eles[i - 1] + e + eles[i + 1]) / 3
      })
      // Keep it raw, but cap points so the chart stays responsive on huge tracks.
      const MAX_POINTS = 800
      const stride = smoothed.length > MAX_POINTS ? Math.ceil(smoothed.length / MAX_POINTS) : 1
      for (let i = 0; i < smoothed.length; i += stride) {
        profile.push({ distance: Math.round(cumDist[i] * 100) / 100, elevation: Math.round(smoothed[i]) })
      }
      // Always include the final point so the profile spans the full distance.
      const lastIdx = smoothed.length - 1
      if (profile[profile.length - 1]?.distance !== Math.round(cumDist[lastIdx] * 100) / 100) {
        profile.push({ distance: Math.round(cumDist[lastIdx] * 100) / 100, elevation: Math.round(smoothed[lastIdx]) })
      }
    }

    return { coords, distanceKm: Math.round(distanceKm * 10) / 10, elevationM: Math.round(elevationM), profile }
  } catch {
    return EMPTY_GPX
  }
}

interface Props {
  data: EventFormData
  update: (p: Partial<EventFormData>) => void
  onNext: () => void
  onBack: () => void
}

export default function DisciplinesTracksStep({ data, update, onNext, onBack }: Props) {
  const [selectedDayId, setSelectedDayId] = useState(data.days[0]?.id || '')
  const [map3d, setMap3d] = useState(false)
  const [selectedDiscId, setSelectedDiscId] = useState<string>('')
  const [editingDiscId, setEditingDiscId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [addingToDayId, setAddingToDayId] = useState<string | null>(null)
  const [newDiscName, setNewDiscName] = useState('')
  const [confirmRemoveDayId, setConfirmRemoveDayId] = useState<string | null>(null)
  const [hoverElevIndex, setHoverElevIndex] = useState<number | null>(null)
  /** Track IDs that are hidden on the map */
  const [hiddenTrackIds, setHiddenTrackIds] = useState<Set<string>>(new Set())
  /** Day IDs that are hidden on the map */
  const [hiddenDayIds, setHiddenDayIds] = useState<Set<string>>(new Set())

  const selectedDay = data.days.find(d => d.id === selectedDayId) || data.days[0]
  const selectedDisc = selectedDay?.disciplines.find(d => d.id === selectedDiscId) || selectedDay?.disciplines[0]
  // Prefer the real (near-raw) GPX elevation profile; fall back to a synthetic
  // one only when the track has no elevation data.
  const elevProfile = selectedDisc?.elevationProfile?.length
    ? selectedDisc.elevationProfile
    : generateElevationProfile(80, 900, selectedDisc?.elevation || 800)

  const getTrackCoords = (disc: Discipline): [number, number][] =>
    disc.gpxCoordinates?.length ? disc.gpxCoordinates : FALLBACK_TRACK

  // All tracks for the selected day
  const dayTracks = useMemo(() => (selectedDay?.disciplines.map(disc => ({
    id: disc.id,
    coordinates: getTrackCoords(disc),
    color: disc.color,
  })) || []), [selectedDay])

  // Visible tracks based on hidden state
  const visibleTrackIds = useMemo(() => {
    const allDayDiscIds = new Set(selectedDay?.disciplines.map(d => d.id) || [])
    const visible = new Set<string>()
    allDayDiscIds.forEach(id => {
      if (!hiddenTrackIds.has(id)) visible.add(id)
    })
    return visible
  }, [selectedDay, hiddenTrackIds])

  // Track bounds for auto-centering
  const trackBounds = useMemo(() => {
    const visibleTracks = dayTracks.filter(t => visibleTrackIds.has(t.id))
    return computeTrackBounds(visibleTracks.length > 0 ? visibleTracks : dayTracks)
  }, [dayTracks, visibleTrackIds])

  // Elevation hover → map dot coordinate
  const selectedTrackCoords = selectedDisc ? getTrackCoords(selectedDisc) : null
  const hoverCoord: [number, number] | undefined =
    hoverElevIndex !== null && selectedTrackCoords && selectedTrackCoords.length > 0
      ? selectedTrackCoords[Math.round(hoverElevIndex / Math.max(elevProfile.length - 1, 1) * (selectedTrackCoords.length - 1))]
      : undefined

  const updateDisc = useCallback((dayId: string, discId: string, patch: Partial<Discipline>) => {
    update({
      days: data.days.map(d =>
        d.id === dayId
          ? { ...d, disciplines: d.disciplines.map(disc => disc.id === discId ? { ...disc, ...patch } : disc) }
          : d
      ),
    })
  }, [data.days, update])

  const addDay = () => {
    const last = data.days[data.days.length - 1]
    const nextDate = new Date(last?.date || data.dates[0] || new Date())
    nextDate.setDate(nextDate.getDate() + 1)
    const newDay: EventDay = { id: `day-${Date.now()}`, date: nextDate, disciplines: [], pois: [], assignments: [] }
    update({ days: [...data.days, newDay], dates: [...data.dates, nextDate] })
    setSelectedDayId(newDay.id)
  }

  const requestRemoveDay = (dayId: string) => {
    const day = data.days.find(d => d.id === dayId)
    if (day && day.disciplines.length > 0) {
      setConfirmRemoveDayId(dayId)
    } else {
      doRemoveDay(dayId)
    }
  }

  const doRemoveDay = (dayId: string) => {
    const dayIndex = data.days.findIndex(d => d.id === dayId)
    const remaining = data.days.filter(d => d.id !== dayId)
    const newDates = data.dates.filter((_, i) => i !== dayIndex)
    update({ days: remaining, dates: newDates })
    if (selectedDayId === dayId) setSelectedDayId(remaining[0]?.id || '')
    setConfirmRemoveDayId(null)
  }

  const confirmAddDiscipline = (dayId: string) => {
    const name = newDiscName.trim() || 'New Discipline'
    const colorIdx = data.days.flatMap(d => d.disciplines).length % DISCIPLINE_COLORS.length
    const newDisc: Discipline = {
      id: `d-${Date.now()}`,
      name,
      type: 'trail-run',
      distance: 0,
      elevation: 0,
      color: DISCIPLINE_COLORS[colorIdx],
      gpxUploaded: false,
    }
    update({ days: data.days.map(d => d.id === dayId ? { ...d, disciplines: [...d.disciplines, newDisc] } : d) })
    setSelectedDiscId(newDisc.id)
    setAddingToDayId(null)
    setNewDiscName('')
  }

  const deleteDiscipline = (dayId: string, discId: string) => {
    update({ days: data.days.map(d => d.id === dayId ? { ...d, disciplines: d.disciplines.filter(disc => disc.id !== discId) } : d) })
    if (selectedDiscId === discId) setSelectedDiscId('')
  }

  const startEdit = (disc: Discipline) => { setEditingDiscId(disc.id); setEditingName(disc.name) }

  const confirmEdit = (dayId: string) => {
    if (!editingDiscId) return
    updateDisc(dayId, editingDiscId, { name: editingName.trim() || editingName })
    setEditingDiscId(null)
    setEditingName('')
  }

  const handleGPXUpload = useCallback(async (dayId: string, discId: string, file: File) => {
    const text = await file.text()
    const { coords, distanceKm, elevationM, profile } = parseGPX(text)
    const patch: Partial<Discipline> = {
      gpxFile: file.name,
      gpxUploaded: true,
    }
    if (coords.length > 0) {
      patch.gpxCoordinates = coords
      if (distanceKm > 0) patch.distance = distanceKm
      if (elevationM > 0) patch.elevation = elevationM
      if (profile.length > 0) patch.elevationProfile = profile
    }
    try {
      const url = await uploadGPX(file)
      patch.gpxUrl = url
    } catch {
      // upload failure is non-fatal — local parse still works
    }
    updateDisc(dayId, discId, patch)
  }, [updateDisc])

  const toggleTrack = (trackId: string) => {
    setHiddenTrackIds(prev => {
      const next = new Set(prev)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      return next
    })
  }

  const toggleDay = (dayId: string) => {
    const day = data.days.find(d => d.id === dayId)
    if (!day) return
    const discIds = day.disciplines.map(d => d.id)
    const allHidden = discIds.every(id => hiddenTrackIds.has(id))
    setHiddenTrackIds(prev => {
      const next = new Set(prev)
      if (allHidden) {
        discIds.forEach(id => next.delete(id))
      } else {
        discIds.forEach(id => next.add(id))
      }
      return next
    })
  }

  const isDayHidden = (dayId: string) => {
    const day = data.days.find(d => d.id === dayId)
    if (!day || day.disciplines.length === 0) return false
    return day.disciplines.every(d => hiddenTrackIds.has(d.id))
  }

  const multipledays = data.days.length > 1

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div
        className="w-[340px] flex-shrink-0 flex flex-col h-full overflow-y-auto"
        style={{ borderRight: '1px solid rgba(148,163,184,0.08)', background: 'rgba(10,18,34,0.6)' }}
      >
        <div className="p-5">
          <h2 className="text-base font-bold text-slate-100 mb-1">Disciplines & Tracks</h2>
          <p className="text-xs mb-5" style={{ color: '#64748b' }}>Add days, disciplines and upload GPX tracks for each discipline.</p>

          <div className="text-xs font-semibold mb-3" style={{ color: '#64748b' }}>EVENT DAYS</div>

          <div className="space-y-2">
            {data.days.map((day, i) => (
              <div key={day.id}>
                {confirmRemoveDayId === day.id ? (
                  <div
                    className="p-3 rounded-xl"
                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: '#ef4444' }} />
                      <span className="text-xs font-semibold text-slate-300">
                        Day {i + 1} has {day.disciplines.length} discipline{day.disciplines.length !== 1 ? 's' : ''}. Remove all?
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmRemoveDayId(null)}
                        className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{ background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => doRemoveDay(day.id)}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171' }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Day header */}
                    <div
                      className="flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all"
                      style={{
                        background: selectedDayId === day.id ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.04)',
                        border: selectedDayId === day.id ? '1px solid rgba(34,197,94,0.3)' : '1px solid transparent',
                      }}
                      onClick={() => setSelectedDayId(day.id)}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="font-semibold text-sm text-slate-200">Day {i + 1}</div>
                          {selectedDayId === day.id && (
                            <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{ background: '#22c55e' }}>
                              <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                          {day.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                          {day.disciplines.length} Discipline{day.disciplines.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                      {data.days.length > 1 && (
                        <button
                          onClick={e => { e.stopPropagation(); requestRemoveDay(day.id) }}
                          className="p-1 rounded-lg hover:bg-red-500/20 transition-colors"
                          title="Remove day"
                        >
                          <X className="w-4 h-4 text-slate-500 hover:text-red-400" />
                        </button>
                      )}
                    </div>

                    {/* Disciplines under selected day */}
                    {selectedDayId === day.id && (
                      <div className="ml-4 mt-2 space-y-2">
                        {day.disciplines.map(disc => (
                          <div
                            key={disc.id}
                            className="rounded-xl p-3 cursor-pointer transition-all"
                            style={{
                              background: selectedDiscId === disc.id ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
                              border: selectedDiscId === disc.id ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(148,163,184,0.06)',
                            }}
                            onClick={() => setSelectedDiscId(disc.id)}
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <div
                                className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0"
                                style={{ background: disc.color + '22' }}
                              >
                                {DISCIPLINE_ICONS[disc.type] || '🏃'}
                              </div>
                              <div className="flex-1 min-w-0">
                                {editingDiscId === disc.id ? (
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      autoFocus
                                      value={editingName}
                                      onChange={e => setEditingName(e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Enter') confirmEdit(day.id); if (e.key === 'Escape') setEditingDiscId(null) }}
                                      className="flex-1 px-2 py-1 rounded-lg text-sm text-slate-100 outline-none"
                                      style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(34,197,94,0.4)' }}
                                      onClick={e => e.stopPropagation()}
                                    />
                                    <button onClick={e => { e.stopPropagation(); confirmEdit(day.id) }} className="p-1 rounded hover:bg-green-500/20">
                                      <Check className="w-3.5 h-3.5 text-green-400" />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="text-sm font-semibold text-slate-200 truncate">{disc.name}</div>
                                )}
                                <div className="flex items-center gap-2 text-xs mt-0.5">
                                  <span style={{ color: '#94a3b8' }}>{disc.distance} km</span>
                                  <span style={{ color: '#64748b' }}>·</span>
                                  <span style={{ color: '#94a3b8' }}>{disc.elevation.toLocaleString()} m+</span>
                                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: disc.color }} />
                                </div>
                              </div>
                            </div>

                            {disc.gpxUploaded && disc.gpxFile && (
                              <div
                                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg mb-2"
                                style={{ background: 'rgba(255,255,255,0.04)' }}
                              >
                                <FileText className="w-3 h-3" style={{ color: '#22c55e' }} />
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium text-slate-300 truncate">{disc.gpxFile}</div>
                                  <div className="text-[10px]" style={{ color: '#22c55e' }}>
                                    {disc.distance} km · {disc.elevation.toLocaleString()} m+
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Color picker (shown when disc selected) */}
                            {selectedDiscId === disc.id && (
                              <div className="mb-2" onClick={e => e.stopPropagation()}>
                                <div className="text-[10px] font-semibold mb-1.5" style={{ color: '#64748b' }}>COLOR</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {COLOR_PALETTE.map(c => (
                                    <button
                                      key={c}
                                      onClick={() => updateDisc(day.id, disc.id, { color: c })}
                                      className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                                      style={{
                                        background: c,
                                        border: disc.color === c ? '2px solid white' : '2px solid transparent',
                                        boxShadow: disc.color === c ? `0 0 6px ${c}` : 'none',
                                      }}
                                    />
                                  ))}
                                </div>

                                <div className="text-[10px] font-semibold mt-2.5 mb-1.5" style={{ color: '#64748b' }}>DISCIPLINE TYPE</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {DISCIPLINE_ICON_OPTIONS.map(opt => (
                                    <button
                                      key={opt.type}
                                      onClick={() => updateDisc(day.id, disc.id, { type: opt.type })}
                                      title={opt.label}
                                      className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-all text-center"
                                      style={{
                                        background: disc.type === opt.type ? disc.color + '25' : 'rgba(255,255,255,0.04)',
                                        border: disc.type === opt.type ? `1px solid ${disc.color}60` : '1px solid rgba(148,163,184,0.08)',
                                      }}
                                    >
                                      <span className="text-sm">{opt.emoji}</span>
                                      <span className="text-[9px]" style={{ color: disc.type === opt.type ? '#f1f5f9' : '#64748b' }}>
                                        {opt.label}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Action buttons */}
                            <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => startEdit(disc)}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all"
                                style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                              >
                                <Edit2 className="w-3 h-3" /> Edit
                              </button>
                              <button
                                onClick={() => deleteDiscipline(day.id, disc.id)}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all"
                                style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.15)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
                              >
                                <Trash2 className="w-3 h-3" /> Delete
                              </button>
                              <label
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all cursor-pointer"
                                style={{ background: disc.gpxUploaded ? 'rgba(34,197,94,0.08)' : 'rgba(59,130,246,0.08)', color: disc.gpxUploaded ? '#4ade80' : '#60a5fa' }}
                                onMouseEnter={e => (e.currentTarget.style.background = disc.gpxUploaded ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.15)')}
                                onMouseLeave={e => (e.currentTarget.style.background = disc.gpxUploaded ? 'rgba(34,197,94,0.08)' : 'rgba(59,130,246,0.08)')}
                              >
                                <Upload className="w-3 h-3" /> GPX
                                <input
                                  type="file"
                                  accept=".gpx"
                                  className="hidden"
                                  onChange={e => {
                                    const file = e.target.files?.[0]
                                    if (file) handleGPXUpload(day.id, disc.id, file)
                                    e.target.value = ''
                                  }}
                                />
                              </label>
                            </div>
                          </div>
                        ))}

                        {/* Inline new discipline input */}
                        {addingToDayId === day.id ? (
                          <div
                            className="flex items-center gap-2 p-2.5 rounded-xl"
                            style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.25)' }}
                          >
                            <input
                              autoFocus
                              value={newDiscName}
                              onChange={e => setNewDiscName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') confirmAddDiscipline(day.id)
                                if (e.key === 'Escape') { setAddingToDayId(null); setNewDiscName('') }
                              }}
                              placeholder="Discipline name..."
                              className="flex-1 px-2 py-1 rounded-lg text-sm text-slate-100 outline-none"
                              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(34,197,94,0.3)' }}
                            />
                            <button
                              onClick={() => confirmAddDiscipline(day.id)}
                              className="p-1.5 rounded-lg"
                              style={{ background: '#22c55e' }}
                            >
                              <Check className="w-3.5 h-3.5 text-white" />
                            </button>
                            <button
                              onClick={() => { setAddingToDayId(null); setNewDiscName('') }}
                              className="p-1.5 rounded-lg"
                              style={{ background: 'rgba(255,255,255,0.06)' }}
                            >
                              <X className="w-3.5 h-3.5 text-slate-400" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setAddingToDayId(day.id); setNewDiscName('') }}
                            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all"
                            style={{
                              background: 'rgba(255,255,255,0.03)',
                              border: '1px dashed rgba(148,163,184,0.15)',
                              color: '#64748b',
                            }}
                          >
                            <Plus className="w-3.5 h-3.5" /> Add Discipline
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}

            <button
              onClick={addDay}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-all"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1.5px dashed rgba(148,163,184,0.15)',
                color: '#64748b',
              }}
            >
              <Plus className="w-4 h-4" /> Add Day
            </button>
          </div>
        </div>

        {/* Navigation */}
        <div className="mt-auto p-5 pt-0">
          <div className="flex gap-3">
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

      {/* Right: Map + elevation */}
      <div className="flex-1 flex flex-col h-full">
        {/* Map */}
        <div className="flex-1 relative min-h-0">
          <div className="absolute inset-0">
            <MapWrapper
              center={trackBounds?.center || MAP_CENTER}
              zoom={12}
              enable3d={map3d}
              tracks={dayTracks}
              visibleTrackIds={visibleTrackIds}
              pois={selectedDay?.pois || []}
              hoverCoord={hoverCoord}
              hoverCoordColor={selectedDisc?.color || '#f97316'}
              fitBounds={trackBounds?.bounds}
            />
          </div>
          <Map3dToggle on={map3d} onToggle={() => setMap3d(v => !v)} />

          {/* Track legend overlay — grouped by day, clickable */}
          <div className="absolute top-4 right-4 flex flex-col gap-1 max-h-[calc(100%-2rem)] overflow-y-auto">
            {data.days.map((day, dayIdx) => {
              if (day.disciplines.length === 0) return null
              const dayHidden = isDayHidden(day.id)
              const isSelectedDay = day.id === selectedDayId
              return (
                <div key={day.id} className="flex flex-col gap-1">
                  {/* Day toggle (shown for multi-day) */}
                  {multipledays && (
                    <button
                      onClick={() => toggleDay(day.id)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all text-left w-full"
                      style={{
                        background: 'rgba(10,20,36,0.92)',
                        border: isSelectedDay ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(148,163,184,0.15)',
                        backdropFilter: 'blur(8px)',
                        color: dayHidden ? '#475569' : (isSelectedDay ? '#22c55e' : '#94a3b8'),
                        opacity: dayHidden ? 0.6 : 1,
                      }}
                    >
                      {dayHidden ? <EyeOff className="w-3 h-3 flex-shrink-0" /> : <Eye className="w-3 h-3 flex-shrink-0" />}
                      <span>Day {dayIdx + 1}</span>
                      <span className="ml-auto text-[10px]" style={{ color: '#64748b' }}>
                        {day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </button>
                  )}
                  {/* Discipline tracks under this day */}
                  {day.disciplines.map(disc => {
                    const hidden = hiddenTrackIds.has(disc.id)
                    return (
                      <button
                        key={disc.id}
                        onClick={() => toggleTrack(disc.id)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition-all text-left w-full"
                        style={{
                          background: 'rgba(10,20,36,0.9)',
                          border: `1px solid ${hidden ? 'rgba(148,163,184,0.1)' : disc.color + '40'}`,
                          backdropFilter: 'blur(8px)',
                          opacity: hidden ? 0.5 : 1,
                          marginLeft: multipledays ? '8px' : '0',
                        }}
                      >
                        {hidden
                          ? <EyeOff className="w-3 h-3 flex-shrink-0 text-slate-500" />
                          : <div className="w-2.5 h-1 rounded-full flex-shrink-0" style={{ background: disc.color }} />
                        }
                        <span className={hidden ? 'text-slate-500' : 'text-slate-200'}>{disc.name}</span>
                        {disc.distance > 0 && (
                          <span className="text-slate-400 text-xs ml-auto">{disc.distance} km</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>

        {/* Elevation chart with hover tracking */}
        {selectedDisc && (
          <div
            className="h-[140px] flex-shrink-0 p-4"
            style={{ background: 'rgba(10,18,34,0.95)', borderTop: '1px solid rgba(148,163,184,0.08)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Mountain className="w-3.5 h-3.5" style={{ color: '#f97316' }} />
                <span className="text-xs font-medium text-slate-400">Elevation Profile — {selectedDisc.name}</span>
              </div>
              <span className="text-xs" style={{ color: '#64748b' }}>
                {selectedDisc.elevation.toLocaleString()} m gain · {selectedDisc.distance} km
              </span>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={elevProfile}
                margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                onMouseMove={(state: any) => {
                  if (state?.activeTooltipIndex !== undefined) setHoverElevIndex(state.activeTooltipIndex)
                }}
                onMouseLeave={() => setHoverElevIndex(null)}
              >
                <defs>
                  <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={selectedDisc.color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={selectedDisc.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="distance" hide />
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
                  labelFormatter={(l: number) => `${l.toFixed(1)} km`}
                />
                <Area
                  type="linear"
                  dataKey="elevation"
                  stroke={selectedDisc.color}
                  strokeWidth={1.5}
                  fill="url(#elevGrad)"
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{ r: 4, fill: selectedDisc.color, stroke: 'white', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
