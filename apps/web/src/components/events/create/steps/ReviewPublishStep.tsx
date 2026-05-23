'use client'

import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronDown, ChevronRight, Calendar, MapPin, Activity, Users, Eye, EyeOff } from 'lucide-react'
import MapWrapper from '@/components/map/MapWrapper'
import type { EventFormData } from '@/lib/types'
import { POI_CONFIGS, MAP_CENTER, VEHICLE_CONFIGS } from '@/lib/constants'
import { MOCK_USERS } from '@/lib/mock-data'
import { formatShortDate, computeTrackBounds } from '@/lib/utils'

const FALLBACK_COORDS: [number, number][] = [
  [23.322, 42.698], [23.330, 42.706], [23.342, 42.702],
  [23.340, 42.691], [23.328, 42.687], [23.318, 42.693], [23.322, 42.698],
]

interface Props {
  data: EventFormData
  onPublish: () => void
  onBack: () => void
  publishing: boolean
  generatingSnapshot?: boolean
}

function Collapsible({ title, icon: Icon, iconColor, defaultOpen = true, children }: {
  title: string
  icon: React.ElementType
  iconColor: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(148,163,184,0.08)' }}>
      <button
        className="flex items-center justify-between w-full p-4 text-left"
        style={{ background: 'rgba(255,255,255,0.03)' }}
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2.5">
          <Icon className="w-4 h-4" style={{ color: iconColor }} />
          <span className="font-semibold text-sm text-slate-200">{title}</span>
        </div>
        <ChevronDown
          className="w-4 h-4 transition-transform"
          style={{ color: '#64748b', transform: open ? 'rotate(0)' : 'rotate(-90deg)' }}
        />
      </button>
      {open && (
        <div className="p-4 pt-0" style={{ borderTop: '1px solid rgba(148,163,184,0.06)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

export default function ReviewPublishStep({ data, onPublish, onBack, publishing, generatingSnapshot }: Props) {
  const allPois = data.days.flatMap(d => d.pois)
  const allAssignments = data.days.flatMap(d => d.assignments)
  const medicalPOIs = allPois.filter(p => POI_CONFIGS.find(c => c.type === p.type)?.category === 'medical')
  const waterPOIs = allPois.filter(p => p.type === 'water-point')

  const totalDiscs = data.days.reduce((s, d) => s + d.disciplines.length, 0)
  const vehiclesCount = allAssignments.filter(a => a.vehicle).length

  // Build track layers from real data
  const dayGroups = useMemo(() => data.days.map((day, i) => ({
    dayId: day.id,
    dayLabel: `Day ${i + 1}`,
    dayDate: day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    tracks: day.disciplines.map(disc => ({
      id: disc.id,
      name: disc.name,
      color: disc.color,
      coordinates: disc.gpxCoordinates?.length ? disc.gpxCoordinates : FALLBACK_COORDS,
    })),
  })), [data.days])

  const allTracks = useMemo(() => dayGroups.flatMap(g => g.tracks), [dayGroups])

  const [hiddenTrackIds, setHiddenTrackIds] = useState<Set<string>>(new Set())

  const visibleTrackIds = useMemo(() => {
    if (allTracks.length === 0) return undefined
    return new Set(allTracks.filter(t => !hiddenTrackIds.has(t.id)).map(t => t.id))
  }, [allTracks, hiddenTrackIds])

  const trackBounds = useMemo(() => {
    const visible = allTracks.filter(t => !hiddenTrackIds.has(t.id))
    return computeTrackBounds(visible.length > 0 ? visible : allTracks)
  }, [allTracks, hiddenTrackIds])

  const multipledays = data.days.length > 1

  const toggleTrack = (trackId: string) => {
    setHiddenTrackIds(prev => {
      const next = new Set(prev)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      return next
    })
  }

  const toggleDay = (dayId: string) => {
    const group = dayGroups.find(g => g.dayId === dayId)
    if (!group) return
    const trackIds = group.tracks.map(t => t.id)
    const allHidden = trackIds.every(id => hiddenTrackIds.has(id))
    setHiddenTrackIds(prev => {
      const next = new Set(prev)
      if (allHidden) {
        trackIds.forEach(id => next.delete(id))
      } else {
        trackIds.forEach(id => next.add(id))
      }
      return next
    })
  }

  const isDayHidden = (dayId: string) => {
    const group = dayGroups.find(g => g.dayId === dayId)
    if (!group || group.tracks.length === 0) return false
    return group.tracks.every(t => hiddenTrackIds.has(t.id))
  }

  return (
    <div className="flex h-full">
      {/* Left: Review */}
      <div
        className="w-[420px] flex-shrink-0 flex flex-col h-full overflow-y-auto"
        style={{ borderRight: '1px solid rgba(148,163,184,0.08)', background: 'rgba(10,18,34,0.6)' }}
      >
        <div className="p-5 space-y-3">
          <div>
            <h2 className="text-base font-bold text-slate-100">Review & Publish</h2>
            <p className="text-xs mt-1" style={{ color: '#64748b' }}>Review all event details before publishing.</p>
          </div>

          {/* Event Info */}
          <Collapsible title="EVENT INFORMATION" icon={Calendar} iconColor="#22c55e">
            <div className="flex gap-3 mt-3">
              {data.imageUrl && (
                <img src={data.imageUrl} alt="" className="w-24 h-16 rounded-xl object-cover flex-shrink-0" />
              )}
              <div className="flex-1 space-y-1.5">
                <div className="font-mono text-xs text-slate-400">{data.eventKey}</div>
                <div className="font-semibold text-slate-200 text-sm">{data.title}</div>
                <div className="flex items-center gap-1.5 text-xs" style={{ color: '#94a3b8' }}>
                  <Calendar className="w-3 h-3" style={{ color: '#64748b' }} />
                  {data.dates.map(d => formatShortDate(d)).join(' – ')} ({data.dates.length} Day{data.dates.length > 1 ? 's' : ''})
                </div>
                <div className="flex items-center gap-1.5 text-xs" style={{ color: '#94a3b8' }}>
                  <MapPin className="w-3 h-3" style={{ color: '#64748b' }} />
                  {data.location?.name || '—'}
                </div>
              </div>
            </div>
          </Collapsible>

          {/* Disciplines */}
          <Collapsible title="DISCIPLINES & TRACKS" icon={Activity} iconColor="#3b82f6">
            <div className="space-y-3 mt-3">
              {data.days.map((day, i) => (
                <div key={day.id}>
                  <div className="text-xs font-semibold mb-1.5" style={{ color: '#64748b' }}>
                    Day {i + 1} – {day.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                  <div className="space-y-1">
                    {day.disciplines.map(disc => (
                      <div key={disc.id} className="flex items-center gap-3 text-xs">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: disc.color }} />
                        <span className="flex-1 text-slate-300">{disc.name}</span>
                        <span style={{ color: '#64748b' }}>{disc.distance} km</span>
                        <span style={{ color: '#64748b' }}>{disc.elevation.toLocaleString()} m+</span>
                        {disc.gpxUploaded && (
                          <span className="text-[10px] font-semibold" style={{ color: '#22c55e' }}>GPX</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Collapsible>

          {/* POIs */}
          <Collapsible title="POINTS OF INTEREST" icon={MapPin} iconColor="#ef4444">
            <div className="grid grid-cols-3 gap-2 mt-3">
              {[
                { label: 'Base Camps', count: allPois.filter(p => p.type === 'base-medical-camp').length, color: '#ef4444' },
                { label: 'Ambulance', count: allPois.filter(p => p.type === 'ambulance').length, color: '#ef4444' },
                { label: 'Medical Points', count: allPois.filter(p => p.type === 'medical-point').length, color: '#ef4444' },
                { label: 'Water Points', count: waterPOIs.length, color: '#3b82f6' },
                { label: 'WC', count: allPois.filter(p => p.type === 'wc').length, color: '#8b5cf6' },
                { label: 'Wardrobe', count: allPois.filter(p => p.type === 'wardrobe').length, color: '#f97316' },
                { label: 'Parking', count: allPois.filter(p => p.type === 'parking').length, color: '#f59e0b' },
              ].map(({ label, count, color }) => (
                <div
                  key={label}
                  className="text-center p-2.5 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.04)' }}
                >
                  <div className="text-lg font-bold" style={{ color }}>{count}</div>
                  <div className="text-[10px] mt-0.5 leading-tight" style={{ color: '#64748b' }}>{label}</div>
                </div>
              ))}
            </div>
          </Collapsible>

          {/* Team */}
          <Collapsible title="TEAM ASSIGNMENT" icon={Users} iconColor="#8b5cf6">
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="text-center p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <div className="text-2xl font-bold" style={{ color: '#8b5cf6' }}>{allAssignments.length}</div>
                <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>Assigned Medics</div>
              </div>
              <div className="text-center p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <div className="text-2xl font-bold" style={{ color: '#3b82f6' }}>{vehiclesCount}</div>
                <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>Vehicles Assigned</div>
              </div>
            </div>
            {allAssignments.length > 0 && (
              <div className="mt-3 space-y-1.5 max-h-36 overflow-y-auto">
                {allAssignments.slice(0, 5).map((a, i) => {
                  const user = MOCK_USERS.find(u => u.id === a.userId)
                  const vehicle = VEHICLE_CONFIGS.find(v => v.value === a.vehicle)
                  if (!user) return null
                  return (
                    <div key={`${a.userId}-${i}`} className="flex items-center gap-2 text-xs">
                      <span className="text-slate-300 flex-1 truncate">{user.name}</span>
                      {a.position && <span className="text-slate-500 truncate max-w-[80px]">{a.position}</span>}
                      {vehicle && <span style={{ color: '#64748b' }}>{vehicle.icon}</span>}
                    </div>
                  )
                })}
                {allAssignments.length > 5 && (
                  <div className="text-xs text-center mt-1" style={{ color: '#64748b' }}>
                    +{allAssignments.length - 5} more
                  </div>
                )}
              </div>
            )}
          </Collapsible>

          {/* Publish note */}
          <div
            className="flex items-start gap-2.5 p-4 rounded-2xl"
            style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)' }}
          >
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#22c55e' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs" style={{ color: '#94a3b8' }}>
              After publishing, this event will be visible to all selected team members.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.15)', color: '#94a3b8' }}
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={onPublish}
              disabled={publishing}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-70"
              style={{
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                boxShadow: '0 4px 14px rgba(34,197,94,0.35)',
              }}
            >
              {generatingSnapshot ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generating map…
                </>
              ) : publishing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Publishing…
                </>
              ) : (
                <>Publish Event <ChevronRight className="w-4 h-4" /></>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Right: Map */}
      <div className="flex-1 relative h-full">
        <MapWrapper
          center={trackBounds?.center || MAP_CENTER}
          zoom={11}
          pois={allPois}
          tracks={allTracks}
          visibleTrackIds={visibleTrackIds}
          fitBounds={trackBounds?.bounds}
        />

        {/* Track visibility overlay — grouped by day */}
        {allTracks.length > 0 && (
          <div className="absolute top-4 right-4 flex flex-col gap-1 max-h-[calc(100%-6rem)] overflow-y-auto">
            {dayGroups.map((group, dayIdx) => {
              if (group.tracks.length === 0) return null
              const dayHidden = isDayHidden(group.dayId)
              return (
                <div key={group.dayId} className="flex flex-col gap-1">
                  {multipledays && (
                    <button
                      onClick={() => toggleDay(group.dayId)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all text-left w-full"
                      style={{
                        background: 'rgba(10,20,36,0.92)',
                        border: '1px solid rgba(148,163,184,0.15)',
                        backdropFilter: 'blur(8px)',
                        color: dayHidden ? '#475569' : '#94a3b8',
                        opacity: dayHidden ? 0.6 : 1,
                      }}
                    >
                      {dayHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      <span>{group.dayLabel}</span>
                      <span className="ml-auto text-[10px]" style={{ color: '#64748b' }}>{group.dayDate}</span>
                    </button>
                  )}
                  {group.tracks.map(track => {
                    const hidden = hiddenTrackIds.has(track.id)
                    return (
                      <button
                        key={track.id}
                        onClick={() => toggleTrack(track.id)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition-all text-left"
                        style={{
                          background: 'rgba(10,20,36,0.9)',
                          border: `1px solid ${hidden ? 'rgba(148,163,184,0.1)' : track.color + '40'}`,
                          backdropFilter: 'blur(8px)',
                          opacity: hidden ? 0.5 : 1,
                          marginLeft: multipledays ? '8px' : '0',
                        }}
                      >
                        {hidden
                          ? <EyeOff className="w-3 h-3 flex-shrink-0 text-slate-500" />
                          : <div className="w-2.5 h-1 rounded-full flex-shrink-0" style={{ background: track.color }} />
                        }
                        <span className={`text-xs ${hidden ? 'text-slate-500' : 'text-slate-200'}`}>{track.name}</span>
                        {!hidden && (
                          <span className="ml-auto text-[10px] text-slate-400">
                            {data.days.flatMap(d => d.disciplines).find(d => d.id === track.id)?.distance ?? 0} km
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {/* Summary overlay */}
        <div className="absolute bottom-4 left-4 right-4 pointer-events-none">
          <div
            className="inline-flex items-center gap-4 px-5 py-3 rounded-2xl"
            style={{
              background: 'rgba(10,18,34,0.92)',
              border: '1px solid rgba(148,163,184,0.12)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <div className="text-center">
              <div className="font-bold text-sm" style={{ color: '#8b5cf6' }}>{allAssignments.length}</div>
              <div className="text-[10px]" style={{ color: '#64748b' }}>Medics</div>
            </div>
            <div className="w-px h-6" style={{ background: 'rgba(148,163,184,0.1)' }} />
            <div className="text-center">
              <div className="font-bold text-sm" style={{ color: '#3b82f6' }}>{vehiclesCount}</div>
              <div className="text-[10px]" style={{ color: '#64748b' }}>Vehicles</div>
            </div>
            <div className="w-px h-6" style={{ background: 'rgba(148,163,184,0.1)' }} />
            <div className="text-center">
              <div className="font-bold text-sm" style={{ color: '#ef4444' }}>{medicalPOIs.length}</div>
              <div className="text-[10px]" style={{ color: '#64748b' }}>Medical</div>
            </div>
            <div className="w-px h-6" style={{ background: 'rgba(148,163,184,0.1)' }} />
            <div className="text-center">
              <div className="font-bold text-sm" style={{ color: '#22c55e' }}>{totalDiscs}</div>
              <div className="text-[10px]" style={{ color: '#64748b' }}>Disciplines</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
