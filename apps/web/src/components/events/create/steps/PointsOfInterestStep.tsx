'use client'

import { useState, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Info, Trash2, Eye, EyeOff, Check, X, Copy } from 'lucide-react'
import MapWrapper from '@/components/map/MapWrapper'
import type { EventFormData, PointOfInterest, POIType } from '@/lib/types'
import { POI_CONFIGS, MAP_CENTER } from '@/lib/constants'
import { computeTrackBounds } from '@/lib/utils'

interface Props {
  data: EventFormData
  update: (p: Partial<EventFormData>) => void
  onNext: () => void
  onBack: () => void
}

const POI_ICON_LABEL: Record<string, string> = {
  'base-medical-camp': '🏠',
  'ambulance': '🚑',
  'medical-point': '➕',
  'water-point': '💧',
  'wc': 'WC',
  'wardrobe': '👕',
  'parking': 'P',
  'custom': '★',
}

export default function PointsOfInterestStep({ data, update, onNext, onBack }: Props) {
  const [selectedDayId, setSelectedDayId] = useState(data.days[0]?.id || '')
  const [selectedType, setSelectedType] = useState<POIType | null>(null)
  const [customPoiName, setCustomPoiName] = useState('')
  const [hiddenTrackIds, setHiddenTrackIds] = useState<Set<string>>(new Set())
  const [editingPoiId, setEditingPoiId] = useState<string | null>(null)
  const [editingPoiName, setEditingPoiName] = useState('')
  const [showAllDays, setShowAllDays] = useState(false)
  const [copyConfirmDayId, setCopyConfirmDayId] = useState<string | null>(null)

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
    })).filter(t => t.coordinates.length > 0),
  })), [data.days])

  const selectedDayTracks = dayTracks.find(g => g.dayId === selectedDayId)?.tracks || []
  const allTracks = dayTracks.flatMap(g => g.tracks)

  const visibleTracks = showAllDays ? allTracks : selectedDayTracks

  const visibleTrackIds = useMemo(() => {
    if (visibleTracks.length === 0) return undefined
    return new Set(visibleTracks.filter(t => !hiddenTrackIds.has(t.id)).map(t => t.id))
  }, [visibleTracks, hiddenTrackIds])

  const trackBounds = useMemo(() => {
    const tracks = visibleTracks.filter(t => !hiddenTrackIds.has(t.id))
    return computeTrackBounds(tracks.length > 0 ? tracks : (allTracks.length > 0 ? allTracks : []))
  }, [visibleTracks, hiddenTrackIds, allTracks])

  const handleMapClick = useCallback((coords: [number, number]) => {
    if (!selectedType || !selectedDay) return
    const newPOI: PointOfInterest = {
      id: `poi-${Date.now()}`,
      type: selectedType,
      coordinates: coords,
      name: selectedType === 'custom' ? (customPoiName.trim() || 'Custom Point') : undefined,
    }
    updateDayPois(selectedDay.id, [...currentPois, newPOI])
  }, [selectedType, customPoiName, currentPois, selectedDay, updateDayPois])

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
  }

  const confirmEditPoiName = () => {
    if (!editingPoiId || !selectedDay) return
    updateDayPois(selectedDay.id, currentPois.map(p => p.id === editingPoiId ? { ...p, name: editingPoiName.trim() || p.name } : p))
    setEditingPoiId(null)
    setEditingPoiName('')
  }

  const cancelEditPoiName = () => { setEditingPoiId(null); setEditingPoiName('') }

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
                    className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold"
                    style={{
                      background: config.bg,
                      color: config.color,
                      boxShadow: selectedType === config.type ? `0 0 12px ${config.color}40` : 'none',
                    }}
                  >
                    {POI_ICON_LABEL[config.type] || '•'}
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
              <div className="mt-2">
                <input
                  value={customPoiName}
                  onChange={e => setCustomPoiName(e.target.value)}
                  placeholder="Custom point name..."
                  className="w-full px-3 py-2 rounded-xl text-sm text-slate-100 outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(148,163,184,0.2)' }}
                />
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
                        className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold"
                        style={{ background: config?.bg || '#1e293b', color: config?.color || '#fff' }}
                      >
                        {POI_ICON_LABEL[poi.type] || '•'}
                      </div>
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              autoFocus
                              value={editingPoiName}
                              onChange={e => setEditingPoiName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') confirmEditPoiName(); if (e.key === 'Escape') cancelEditPoiName() }}
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
                            {poi.coordinates[0].toFixed(4)}, {poi.coordinates[1].toFixed(4)}
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
                  return (
                    <button
                      key={track.id}
                      onClick={() => toggleTrack(track.id)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all text-left"
                      style={{
                        background: visible ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${visible ? track.color + '40' : 'rgba(148,163,184,0.06)'}`,
                        opacity: visible ? 1 : 0.5,
                      }}
                    >
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: track.color }} />
                      <div className="flex-1 text-xs font-medium text-slate-300 truncate">{track.name}</div>
                      {visible ? <Eye className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#64748b' }} /> : <EyeOff className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#475569' }} />}
                    </button>
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
            pois={displayedPois}
            tracks={visibleTracks}
            visibleTrackIds={visibleTrackIds}
            interactivePOI
            selectedPOIType={selectedType}
            onMapClick={handleMapClick}
            onPOIMove={handlePOIMove}
            fitBounds={trackBounds?.bounds}
          />
        </div>

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
                  className="w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold"
                  style={{ background: config.bg, color: config.color }}
                >
                  {POI_ICON_LABEL[config.type]}
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
