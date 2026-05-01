'use client'

import { useState } from 'react'
import { Plus, X, Upload, Edit2, Trash2, ChevronLeft, ChevronRight, Activity, Mountain } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import MapWrapper from '@/components/map/MapWrapper'
import type { EventFormData, EventDay, Discipline } from '@/lib/types'
import { DISCIPLINE_COLORS, MAP_CENTER } from '@/lib/constants'
import { generateElevationProfile } from '@/lib/mock-data'
import { getDayOfWeek } from '@/lib/utils'

const DISCIPLINE_ICONS: Record<string, string> = {
  'trail-run': '🏃',
  'mtb': '🚵',
  'marathon': '🏃',
  'fun-run': '🤸',
  'bike': '🚴',
  'swim': '🏊',
}

const TRACK_COORDS: Record<string, [number, number][]> = {
  'd1': [[23.472,41.852],[23.478,41.862],[23.488,41.858],[23.495,41.848],[23.490,41.835],[23.480,41.828],[23.470,41.836],[23.472,41.852]],
  'd2': [[23.472,41.852],[23.478,41.862],[23.488,41.858],[23.480,41.850],[23.472,41.852]],
  'd3': [[23.472,41.852],[23.465,41.840],[23.468,41.828],[23.478,41.820],[23.492,41.822],[23.505,41.830],[23.510,41.842],[23.502,41.853],[23.488,41.858],[23.472,41.852]],
  'd4': [[23.472,41.852],[23.460,41.845],[23.452,41.832],[23.458,41.818],[23.472,41.810],[23.488,41.812],[23.500,41.820],[23.510,41.835],[23.510,41.842],[23.502,41.853],[23.488,41.858],[23.472,41.852]],
  'd5': [[23.472,41.852],[23.476,41.856],[23.482,41.853],[23.478,41.848],[23.472,41.852]],
}

interface Props {
  data: EventFormData
  update: (p: Partial<EventFormData>) => void
  onNext: () => void
  onBack: () => void
}

export default function DisciplinesTracksStep({ data, update, onNext, onBack }: Props) {
  const [selectedDayId, setSelectedDayId] = useState(data.days[0]?.id || '')
  const [selectedDiscId, setSelectedDiscId] = useState(data.days[0]?.disciplines[0]?.id || '')

  const selectedDay = data.days.find(d => d.id === selectedDayId) || data.days[0]
  const selectedDisc = selectedDay?.disciplines.find(d => d.id === selectedDiscId) || selectedDay?.disciplines[0]
  const elevProfile = generateElevationProfile(80, 900, selectedDisc?.elevation || 800)

  const tracks = selectedDay?.disciplines.map(disc => ({
    id: disc.id,
    coordinates: TRACK_COORDS[disc.id] || TRACK_COORDS['d1'],
    color: disc.color,
  })) || []

  const addDay = () => {
    const last = data.days[data.days.length - 1]
    const nextDate = new Date(last.date)
    nextDate.setDate(nextDate.getDate() + 1)
    const newDay: EventDay = {
      id: `day-${Date.now()}`,
      date: nextDate,
      disciplines: [],
    }
    update({ days: [...data.days, newDay] })
    setSelectedDayId(newDay.id)
  }

  const removeDay = (dayId: string) => {
    const remaining = data.days.filter(d => d.id !== dayId)
    update({ days: remaining })
    if (selectedDayId === dayId) setSelectedDayId(remaining[0]?.id || '')
  }

  const addDiscipline = (dayId: string) => {
    const colorIdx = data.days.flatMap(d => d.disciplines).length % DISCIPLINE_COLORS.length
    const newDisc: Discipline = {
      id: `d-${Date.now()}`,
      name: 'New Discipline',
      type: 'trail-run',
      distance: 0,
      elevation: 0,
      color: DISCIPLINE_COLORS[colorIdx],
      gpxUploaded: false,
    }
    update({
      days: data.days.map(d =>
        d.id === dayId ? { ...d, disciplines: [...d.disciplines, newDisc] } : d
      ),
    })
    setSelectedDiscId(newDisc.id)
  }

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div
        className="w-[340px] flex-shrink-0 flex flex-col h-full overflow-y-auto"
        style={{ borderRight: '1px solid rgba(148,163,184,0.08)', background: 'rgba(10,18,34,0.6)' }}
      >
        <div className="p-5">
          <h2 className="text-base font-bold text-slate-100 mb-1">Disciplines & Tracks</h2>
          <p className="text-xs mb-5" style={{ color: '#64748b' }}>Add days, disciplines and upload tracks for each discipline.</p>

          <div className="text-xs font-semibold mb-3" style={{ color: '#64748b' }}>EVENT DAYS</div>

          <div className="space-y-2">
            {data.days.map((day, i) => (
              <div key={day.id}>
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
                      onClick={e => { e.stopPropagation(); removeDay(day.id) }}
                      className="p-1 rounded-lg hover:bg-red-500/20 transition-colors"
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
                            className="w-8 h-8 rounded-xl flex items-center justify-center text-base"
                            style={{ background: disc.color + '22' }}
                          >
                            {DISCIPLINE_ICONS[disc.type] || '🏃'}
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-semibold text-slate-200">{disc.name}</div>
                            <div className="flex items-center gap-2 text-xs mt-0.5">
                              <span style={{ color: '#94a3b8' }}>{disc.distance} km</span>
                              <span style={{ color: '#64748b' }}>·</span>
                              <span style={{ color: '#94a3b8' }}>{disc.elevation.toLocaleString()} m+</span>
                              <div className="w-2 h-2 rounded-full" style={{ background: disc.color }} />
                            </div>
                          </div>
                        </div>
                        {disc.gpxUploaded && (
                          <div
                            className="flex items-center justify-between px-2.5 py-1.5 rounded-lg"
                            style={{ background: 'rgba(255,255,255,0.04)' }}
                          >
                            <div>
                              <div className="text-xs font-medium text-slate-300">{disc.gpxFile}</div>
                              <div className="text-[10px]" style={{ color: '#22c55e' }}>Uploaded</div>
                            </div>
                            <div className="flex gap-1">
                              <button className="p-1 hover:bg-white/10 rounded transition-colors">
                                <Edit2 className="w-3 h-3 text-slate-500" />
                              </button>
                              <button className="p-1 hover:bg-white/10 rounded transition-colors">
                                <Trash2 className="w-3 h-3 text-slate-500" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    <button
                      onClick={() => addDiscipline(day.id)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all"
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px dashed rgba(148,163,184,0.15)',
                        color: '#64748b',
                      }}
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Discipline
                    </button>

                    {/* GPX Upload zone */}
                    <label
                      className="w-full flex flex-col items-center gap-2 py-4 rounded-xl cursor-pointer transition-all"
                      style={{
                        background: 'rgba(255,255,255,0.02)',
                        border: '1.5px dashed rgba(148,163,184,0.15)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.4)')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.15)')}
                    >
                      <Upload className="w-5 h-5" style={{ color: '#64748b' }} />
                      <div className="text-xs font-medium text-slate-400">Upload GPX Track</div>
                      <div className="text-[10px]" style={{ color: '#64748b' }}>Drag & drop your GPX file here or click to browse</div>
                      <input type="file" accept=".gpx" className="hidden" />
                    </label>
                  </div>
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
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(148,163,184,0.15)',
                color: '#94a3b8',
              }}
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={onNext}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
              style={{
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                boxShadow: '0 4px 14px rgba(34,197,94,0.3)',
              }}
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
              center={MAP_CENTER}
              zoom={12}
              tracks={tracks}
              pois={[]}
            />
          </div>
          {/* Track distance overlays */}
          {selectedDay && (
            <div className="absolute top-4 right-4 flex flex-col gap-1.5">
              {selectedDay.disciplines.map(disc => (
                <div
                  key={disc.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium"
                  style={{
                    background: 'rgba(10,20,36,0.9)',
                    border: `1px solid ${disc.color}40`,
                    backdropFilter: 'blur(8px)',
                  }}
                >
                  <div className="w-2.5 h-1 rounded-full" style={{ background: disc.color }} />
                  <span className="text-slate-200">{disc.distance} km</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Elevation chart */}
        {selectedDisc && (
          <div
            className="h-[140px] flex-shrink-0 p-4"
            style={{
              background: 'rgba(10,18,34,0.95)',
              borderTop: '1px solid rgba(148,163,184,0.08)',
            }}
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
              <AreaChart data={elevProfile} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
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
                  type="monotone"
                  dataKey="elevation"
                  stroke={selectedDisc.color}
                  strokeWidth={2}
                  fill="url(#elevGrad)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
