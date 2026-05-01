'use client'

import { useState } from 'react'
import { MapPin, X, Plus, Upload, Activity, Mountain, CrossIcon, Star, Users, ChevronRight } from 'lucide-react'
import MapWrapper from '@/components/map/MapWrapper'
import type { EventFormData, PointOfInterest } from '@/lib/types'
import { POI_CONFIGS, MAP_CENTER, MAP_ZOOM } from '@/lib/constants'
import { getDayOfWeek } from '@/lib/utils'

const TRACK_MOCK: Array<{ id: string; coordinates: [number, number][]; color: string }> = [
  {
    id: 'tr1', color: '#8b5cf6',
    coordinates: [[23.472, 41.852],[23.478, 41.862],[23.488, 41.858],[23.495, 41.848],[23.490, 41.835],[23.480, 41.828],[23.470, 41.836],[23.472, 41.852]],
  },
  {
    id: 'tr2', color: '#3b82f6',
    coordinates: [[23.472, 41.852],[23.478, 41.862],[23.488, 41.858],[23.480, 41.850],[23.472, 41.852]],
  },
  {
    id: 'tr3', color: '#22c55e',
    coordinates: [[23.472, 41.852],[23.465, 41.840],[23.468, 41.828],[23.478, 41.820],[23.492, 41.822],[23.505, 41.830],[23.510, 41.842],[23.502, 41.853],[23.488, 41.858],[23.472, 41.852]],
  },
  {
    id: 'tr4', color: '#f97316',
    coordinates: [[23.472, 41.852],[23.460, 41.845],[23.452, 41.832],[23.458, 41.818],[23.472, 41.810],[23.488, 41.812],[23.500, 41.820],[23.510, 41.835],[23.510, 41.842],[23.502, 41.853],[23.488, 41.858],[23.472, 41.852]],
  },
]

interface Props { data: EventFormData; update: (p: Partial<EventFormData>) => void; onNext: () => void }

export default function EventInfoStep({ data, update, onNext }: Props) {
  const [mapLayer, setMapLayer] = useState<'outdoor' | 'satellite' | 'terrain'>('outdoor')
  const [showAllPoints, setShowAllPoints] = useState(true)

  const medicalPOIs = data.pois.filter(p => POI_CONFIGS.find(c => c.type === p.type)?.category === 'medical')
  const otherPOIs = data.pois.filter(p => POI_CONFIGS.find(c => c.type === p.type)?.category === 'other')

  const totalKm = data.days.reduce((sum, d) => sum + d.disciplines.reduce((s, disc) => s + disc.distance, 0), 0)
  const totalElev = data.days.reduce((sum, d) => sum + d.disciplines.reduce((s, disc) => s + disc.elevation, 0), 0)

  const addDate = () => {
    const last = data.dates[data.dates.length - 1]
    const next = new Date(last)
    next.setDate(next.getDate() + 1)
    update({ dates: [...data.dates, next] })
  }

  const removeDate = (i: number) => {
    if (data.dates.length <= 1) return
    update({ dates: data.dates.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="flex h-full">
      {/* Left form panel */}
      <div
        className="w-[360px] flex-shrink-0 flex flex-col h-full overflow-y-auto"
        style={{ borderRight: '1px solid rgba(148,163,184,0.08)', background: 'rgba(10,18,34,0.6)' }}
      >
        <div className="p-6 space-y-5">
          <h2 className="text-base font-bold text-slate-100">Event Information</h2>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              Event Title <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              value={data.title}
              onChange={e => update({ title: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl text-sm text-slate-100 outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(148,163,184,0.12)',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.5)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)')}
              placeholder="Enter event title..."
            />
          </div>

          {/* Image */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">Event Image</label>
            <div className="flex gap-2">
              {data.imageUrl ? (
                <div className="relative w-[120px] h-[80px] rounded-xl overflow-hidden flex-shrink-0">
                  <img src={data.imageUrl} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => update({ imageUrl: null })}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ) : null}
              <label
                className="flex-1 h-[80px] rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1.5px dashed rgba(148,163,184,0.2)',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.4)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.2)')}
              >
                <Upload className="w-4 h-4 mb-1" style={{ color: '#64748b' }} />
                <span className="text-xs" style={{ color: '#64748b' }}>Upload image</span>
                <span className="text-[10px] mt-0.5" style={{ color: '#475569' }}>JPG, PNG or WebP</span>
                <input type="file" className="hidden" accept="image/*" />
              </label>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">Event Description</label>
            <textarea
              value={data.description}
              onChange={e => update({ description: e.target.value })}
              rows={3}
              className="w-full px-3.5 py-2.5 rounded-xl text-sm text-slate-100 outline-none resize-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(148,163,184,0.12)',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.5)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)')}
              placeholder="Describe the event..."
            />
          </div>

          {/* Dates */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              Event Date(s) <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {data.dates.map((d, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(148,163,184,0.12)' }}
                >
                  <span className="text-slate-200 font-medium">
                    {d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span className="text-xs" style={{ color: '#64748b' }}>
                    {getDayOfWeek(d)}
                  </span>
                  <button onClick={() => removeDate(i)} className="ml-1">
                    <X className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300 transition-colors" />
                  </button>
                </div>
              ))}
              <button
                onClick={addDate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(148,163,184,0.2)', color: '#64748b' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
                onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
              >
                <Plus className="w-3.5 h-3.5" />
                Add Another Day
              </button>
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">Location</label>
            <div
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)' }}
            >
              <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: '#64748b' }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-200 font-medium truncate">{data.location?.name || 'Set location...'}</div>
                {data.location && (
                  <div className="text-xs mt-0.5 truncate" style={{ color: '#64748b' }}>
                    {data.location.name.split(',').slice(1).join(',').trim() || 'Mountain Range'}
                  </div>
                )}
              </div>
              <button onClick={() => update({ location: null })}>
                <X className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300 transition-colors" />
              </button>
            </div>
          </div>

          {/* Summary stats */}
          <div
            className="grid grid-cols-5 gap-2 pt-4 mt-4"
            style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}
          >
            {[
              { icon: '📅', label: 'Days', value: data.dates.length, color: '#22c55e' },
              { icon: '🏃', label: 'Disciplines', value: data.days.reduce((s, d) => s + d.disciplines.length, 0), color: '#22c55e' },
              { icon: '🏥', label: 'Medical Points', value: medicalPOIs.length, color: '#ef4444' },
              { icon: '📍', label: 'Other Points', value: otherPOIs.length, color: '#f97316' },
              { icon: '👥', label: 'Assigned Medics', value: data.assignments.length, color: '#8b5cf6' },
            ].map(({ icon, label, value, color }) => (
              <div key={label} className="text-center">
                <div className="text-lg font-bold" style={{ color }}>{value}</div>
                <div className="text-[9px] leading-tight mt-0.5" style={{ color: '#64748b' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Next button */}
        <div className="mt-auto p-6 pt-0">
          <div className="flex gap-3">
            <button
              className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(148,163,184,0.15)',
                color: '#94a3b8',
              }}
            >
              Cancel
            </button>
            <button
              onClick={onNext}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
              style={{
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                boxShadow: '0 4px 14px rgba(34,197,94,0.3)',
              }}
            >
              Next Step
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative flex flex-col">
        <div className="flex-1 relative">
          {/* Map search bar */}
          <div
            className="absolute top-4 right-4 z-10 flex items-center gap-2"
          >
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{
                background: 'rgba(10,20,36,0.9)',
                border: '1px solid rgba(148,163,184,0.15)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                placeholder="Search location"
                className="bg-transparent text-sm text-slate-300 outline-none w-32 placeholder-slate-600"
              />
            </div>
            <button
              className="px-3 py-2 rounded-xl text-sm font-medium transition-all"
              style={{
                background: 'rgba(10,20,36,0.9)',
                border: '1px solid rgba(148,163,184,0.15)',
                color: '#94a3b8',
                backdropFilter: 'blur(8px)',
              }}
            >
              3D
            </button>
            <button
              className="p-2 rounded-xl transition-all"
              style={{
                background: 'rgba(10,20,36,0.9)',
                border: '1px solid rgba(148,163,184,0.15)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
              </svg>
            </button>
          </div>

          {/* Show all points toggle */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
            <button
              onClick={() => setShowAllPoints(v => !v)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
              style={{
                background: 'rgba(10,20,36,0.9)',
                border: '1px solid rgba(148,163,184,0.15)',
                color: showAllPoints ? '#f1f5f9' : '#94a3b8',
                backdropFilter: 'blur(8px)',
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Show all points
            </button>
          </div>

          <MapWrapper
            center={data.location?.coordinates || MAP_CENTER}
            zoom={MAP_ZOOM}
            pois={showAllPoints ? data.pois : []}
            tracks={TRACK_MOCK}
          />
        </div>

        {/* Stats bar */}
        <div
          className="flex items-center gap-6 px-6 py-3 flex-shrink-0"
          style={{
            background: 'rgba(10,18,34,0.95)',
            borderTop: '1px solid rgba(148,163,184,0.08)',
          }}
        >
          {[
            { icon: '↗', label: 'Total Tracks', value: `${totalKm.toFixed(1)} km`, color: '#22c55e' },
            { icon: '⛰', label: 'Elevation Gain', value: `${totalElev.toLocaleString()} m`, color: '#f97316' },
            { icon: '🏥', label: 'Medical Points', value: medicalPOIs.length, color: '#ef4444' },
            { icon: '📍', label: 'Other Points', value: otherPOIs.length, color: '#f97316' },
            { icon: '👥', label: 'Assigned Medics', value: data.assignments.length, color: '#8b5cf6' },
          ].map(({ icon, label, value, color }) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-base">{icon}</span>
              <div>
                <div className="font-bold text-sm" style={{ color }}>{value}</div>
                <div className="text-xs" style={{ color: '#64748b' }}>{label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right POI panel */}
      <div
        className="w-[280px] flex-shrink-0 flex flex-col h-full overflow-y-auto"
        style={{
          borderLeft: '1px solid rgba(148,163,184,0.08)',
          background: 'rgba(10,18,34,0.6)',
        }}
      >
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-100 text-sm">Points of Interest</h3>
            <button
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}
            >
              <Plus className="w-3.5 h-3.5" />
              Add Point
            </button>
          </div>

          {/* Medical Points */}
          <POISection
            title="MEDICAL POINTS"
            pois={medicalPOIs}
          />

          {/* Other Points */}
          <POISection
            title="OTHER POINTS"
            pois={otherPOIs}
          />

          {/* Map layers */}
          <div className="mt-5 pt-5" style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}>
            <div className="text-xs font-semibold mb-3" style={{ color: '#64748b' }}>MAP LAYERS</div>
            <div className="space-y-2">
              {(['outdoor', 'satellite', 'terrain'] as const).map(layer => (
                <label key={layer} className="flex items-center gap-2 cursor-pointer group">
                  <div
                    className="w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all"
                    style={{
                      borderColor: mapLayer === layer ? '#22c55e' : 'rgba(148,163,184,0.3)',
                      background: mapLayer === layer ? '#22c55e' : 'transparent',
                    }}
                    onClick={() => setMapLayer(layer)}
                  >
                    {mapLayer === layer && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <span className="text-sm capitalize" style={{ color: '#94a3b8' }}>
                    {layer}
                  </span>
                </label>
              ))}
              <label className="flex items-center gap-2 cursor-pointer mt-3">
                <div
                  className="w-4 h-4 rounded flex items-center justify-center transition-all"
                  style={{ background: '#22c55e' }}
                >
                  <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                  </svg>
                </div>
                <span className="text-sm" style={{ color: '#94a3b8' }}>Track Labels</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function POISection({ title, pois }: { title: string; pois: PointOfInterest[] }) {
  const [open, setOpen] = useState(true)
  const grouped = pois.reduce<Record<string, PointOfInterest[]>>((acc, p) => {
    const key = POI_CONFIGS.find(c => c.type === p.type)?.label || p.type
    acc[key] = [...(acc[key] || []), p]
    return acc
  }, {})

  return (
    <div className="mb-4">
      <button
        className="flex items-center justify-between w-full mb-2"
        onClick={() => setOpen(v => !v)}
      >
        <span className="text-xs font-semibold" style={{ color: '#64748b' }}>{title}</span>
        <svg
          className="w-3.5 h-3.5 transition-transform"
          style={{ color: '#64748b', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="space-y-1.5">
          {Object.entries(grouped).map(([label, items]) => {
            const config = POI_CONFIGS.find(c => c.label === label)!
            return (
              <div
                key={label}
                className="flex items-center gap-2.5 p-2.5 rounded-xl group cursor-pointer transition-all"
                style={{ background: 'rgba(255,255,255,0.03)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
              >
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: config?.bg || '#1e293b' }}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke={config?.color || '#fff'} strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-200 truncate">{label}</div>
                  <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>{items.length} Point{items.length !== 1 ? 's' : ''}</div>
                </div>
                <button className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
