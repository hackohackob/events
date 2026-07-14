'use client'

import { useState, useMemo } from 'react'
import { MapPin, X, Upload, ChevronRight } from 'lucide-react'
import MapWrapper from '@/components/map/MapWrapper'
import MapLayersControl from '@/components/map/MapLayersControl'
import type { BaseLayer } from '@/components/map/MapClient'
import type { EventFormData, PointOfInterest, EventDay } from '@/lib/types'
import { POI_CONFIGS, MAP_CENTER, MAP_ZOOM } from '@/lib/constants'
import { getDayOfWeek, computeTrackBounds } from '@/lib/utils'

const FALLBACK_TRACK: [number, number][] = [
  [23.322, 42.698], [23.330, 42.706], [23.342, 42.702],
  [23.340, 42.691], [23.328, 42.687], [23.318, 42.693], [23.322, 42.698],
]

interface Props { data: EventFormData; update: (p: Partial<EventFormData>) => void; onNext: () => void }

export default function EventInfoStep({ data, update, onNext }: Props) {
  const [showAllPoints, setShowAllPoints] = useState(true)
  const [map3d, setMap3d] = useState(false)
  const [baseLayer, setBaseLayer] = useState<BaseLayer>('streets')

  const allPois = data.days.flatMap(d => d.pois)
  const allAssignments = data.days.flatMap(d => d.assignments)
  const medicalPOIs = allPois.filter(p => POI_CONFIGS.find(c => c.type === p.type)?.category === 'medical')
  const otherPOIs = allPois.filter(p => POI_CONFIGS.find(c => c.type === p.type)?.category !== 'medical')

  const totalKm = data.days.reduce((sum, d) => sum + d.disciplines.reduce((s, disc) => s + disc.distance, 0), 0)
  const totalElev = data.days.reduce((sum, d) => sum + d.disciplines.reduce((s, disc) => s + disc.elevation, 0), 0)
  const eventKeyInvalid = data.eventKey.trim().length > 0 && !/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(data.eventKey.trim())

  const realTracks = useMemo(() => data.days.flatMap(day =>
    day.disciplines.map(disc => ({
      id: disc.id,
      coordinates: disc.gpxCoordinates?.length ? disc.gpxCoordinates : FALLBACK_TRACK,
      color: disc.color,
    }))
  ), [data.days])

  const hasRealTracks = realTracks.some(t => t.coordinates !== FALLBACK_TRACK)
  const trackBounds = useMemo(() => computeTrackBounds(realTracks), [realTracks])

  /** Change the first date; keeps days[0] in sync */
  const handleDateChange = (isoDate: string) => {
    if (!isoDate) return
    const picked = new Date(isoDate + 'T00:00:00')
    const newDates = [picked, ...data.dates.slice(1)]
    const newDays: EventDay[] = data.days.map((d, i) => i === 0 ? { ...d, date: picked } : d)
    if (newDays.length === 0) {
      newDays.push({ id: 'day-1', date: picked, disciplines: [], pois: [], assignments: [] })
    }
    update({ dates: newDates, days: newDays })
  }

  // Format for <input type="date"> value (YYYY-MM-DD)
  const firstDateValue = data.dates[0]
    ? data.dates[0].toLocaleDateString('en-CA') // en-CA gives YYYY-MM-DD
    : ''

  return (
    <div className="flex h-full">
      {/* Left form panel */}
      <div
        className="w-[360px] flex-shrink-0 flex flex-col h-full overflow-y-auto"
        style={{ borderRight: '1px solid rgba(148,163,184,0.08)', background: 'rgba(10,18,34,0.6)' }}
      >
        <div className="p-6 space-y-5">
          <h2 className="text-base font-bold text-slate-100">Event Information</h2>

          {/* Event code */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              Event Code <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              value={data.eventKey}
              onChange={e => update({ eventKey: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
              className="w-full px-3.5 py-2.5 rounded-xl text-sm text-slate-100 outline-none transition-all font-mono"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: eventKeyInvalid ? '1px solid rgba(239,68,68,0.7)' : '1px solid rgba(148,163,184,0.12)',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = eventKeyInvalid ? 'rgba(239,68,68,0.7)' : 'rgba(34,197,94,0.5)')}
              onBlur={e => (e.currentTarget.style.borderColor = eventKeyInvalid ? 'rgba(239,68,68,0.7)' : 'rgba(148,163,184,0.12)')}
              placeholder="event-mphhxbdq"
              spellCheck={false}
              autoCapitalize="none"
            />
            <p className="mt-2 text-[10px] leading-relaxed" style={{ color: eventKeyInvalid ? '#f87171' : '#475569' }}>
              Use 3-64 characters: letters, numbers, underscores, or hyphens.
            </p>
          </div>

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
          {/* TODO: image upload does not work — wiring the file input to storage is pending */}
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
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = ev => update({ imageUrl: ev.target?.result as string })
                    reader.readAsDataURL(file)
                  }}
                />
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

          {/* First Event Date — calendar picker */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              Event Start Date <span style={{ color: '#ef4444' }}>*</span>
            </label>

            <input
              type="date"
              value={firstDateValue}
              onChange={e => handleDateChange(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl text-sm text-slate-100 outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(148,163,184,0.12)',
                colorScheme: 'dark',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.5)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)')}
            />

            {data.dates[0] && (
              <div className="mt-2 flex items-center gap-2 text-xs" style={{ color: '#64748b' }}>
                <span className="font-medium text-slate-300">
                  {data.dates[0].toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            )}

            {/* TODO: when removing a date that already has disciplines configured in Step 2,
                show a warning dialog listing the affected disciplines before proceeding */}
            <p className="mt-2 text-[10px] leading-relaxed" style={{ color: '#475569' }}>
              Additional event days and disciplines are configured in the next step.
            </p>
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
                <div className="text-sm text-slate-200 font-medium truncate">{data.location?.name || 'Set location on the map...'}</div>
                {data.location && (
                  <div className="text-xs mt-0.5 truncate" style={{ color: '#64748b' }}>
                    {data.location.name.split(',').slice(1).join(',').trim() || 'Mountain Range'}
                  </div>
                )}
              </div>
              {data.location && (
                <button onClick={() => update({ location: null })}>
                  <X className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300 transition-colors" />
                </button>
              )}
            </div>
          </div>

          {/* Command Center phone */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">Command Center Phone</label>
            <input
              type="tel"
              value={data.commandPhone}
              onChange={e => update({ commandPhone: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl text-sm text-slate-100 outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(148,163,184,0.12)',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.5)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)')}
              placeholder="+359 88 123 4567"
            />
            <p className="mt-2 text-[10px] leading-relaxed" style={{ color: '#475569' }}>
              Runners can call or text this number for help. Leave blank to hide those options in the runner app.
            </p>
          </div>

          {/* Active hours */}
          <ActiveHoursField
            value={data.activeHours}
            onChange={activeHours => update({ activeHours })}
          />

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
              { icon: '👥', label: 'Assigned Medics', value: allAssignments.length, color: '#8b5cf6' },
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
            center={data.location?.coordinates || trackBounds?.center || MAP_CENTER}
            zoom={MAP_ZOOM}
            baseLayer={baseLayer}
            enable3d={map3d}
            pois={showAllPoints ? allPois : []}
            tracks={realTracks}
            fitBounds={trackBounds?.bounds}
          />
          <MapLayersControl baseLayer={baseLayer} onBaseLayer={setBaseLayer} map3d={map3d} onToggle3d={() => setMap3d(v => !v)} />
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
            { icon: '↗', label: 'Total Distance', value: `${totalKm.toFixed(1)} km`, color: '#22c55e' },
            { icon: '⛰', label: 'Elevation Gain', value: `${totalElev.toLocaleString()} m`, color: '#f97316' },
            { icon: '🏥', label: 'Medical Points', value: medicalPOIs.length, color: '#ef4444' },
            { icon: '📍', label: 'Other Points', value: otherPOIs.length, color: '#f97316' },
            { icon: '👥', label: 'Assigned Medics', value: allAssignments.length, color: '#8b5cf6' },
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
        className="w-[260px] flex-shrink-0 flex flex-col h-full overflow-y-auto"
        style={{
          borderLeft: '1px solid rgba(148,163,184,0.08)',
          background: 'rgba(10,18,34,0.6)',
        }}
      >
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-100 text-sm">Points of Interest</h3>
          </div>

          {allPois.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-8">
              Points of interest are added<br />in Step 3.
            </div>
          ) : (
            <>
              <POISection title="MEDICAL POINTS" pois={medicalPOIs} />
              <POISection title="OTHER POINTS" pois={otherPOIs} />
            </>
          )}

        </div>
      </div>
    </div>
  )
}

const DEFAULT_ACTIVE_HOURS = { start: '07:00', end: '19:00' }

/** Minutes since midnight for a "HH:mm" string. */
function toMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/**
 * Toggle + dual time inputs + a 24h strip visualizing the daily window during
 * which medic locations are visible to everyone (coordinators always see them).
 */
function ActiveHoursField({
  value,
  onChange,
}: {
  value: { start: string; end: string } | null
  onChange: (v: { start: string; end: string } | null) => void
}) {
  const enabled = value !== null
  const hours = value ?? DEFAULT_ACTIVE_HOURS
  const startMin = toMinutes(hours.start)
  const endMin = toMinutes(hours.end)
  const overnight = endMin < startMin

  // Highlighted portions of the 24h strip, as percentages
  const bands = overnight
    ? [
        { left: 0, width: (endMin / 1440) * 100 },
        { left: (startMin / 1440) * 100, width: ((1440 - startMin) / 1440) * 100 },
      ]
    : [{ left: (startMin / 1440) * 100, width: (Math.max(endMin - startMin, 10) / 1440) * 100 }]

  const timeInputStyle = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(148,163,184,0.12)',
    colorScheme: 'dark',
  } as const

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-semibold text-slate-400">Active Hours</label>
        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => onChange(enabled ? null : DEFAULT_ACTIVE_HOURS)}
          className="relative w-9 h-5 rounded-full transition-all flex-shrink-0"
          style={{
            background: enabled ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'rgba(148,163,184,0.2)',
            boxShadow: enabled ? '0 0 12px rgba(34,197,94,0.35)' : 'none',
          }}
        >
          <span
            className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
            style={{ left: enabled ? '18px' : '2px' }}
          />
        </button>
      </div>

      {enabled ? (
        <div
          className="rounded-xl p-3.5 space-y-3"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.12)' }}
        >
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={hours.start}
              onChange={e => e.target.value && onChange({ ...hours, start: e.target.value })}
              className="flex-1 px-3 py-2 rounded-lg text-sm text-slate-100 outline-none transition-all text-center"
              style={timeInputStyle}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.5)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)')}
            />
            <span className="text-xs" style={{ color: '#64748b' }}>to</span>
            <input
              type="time"
              value={hours.end}
              onChange={e => e.target.value && onChange({ ...hours, end: e.target.value })}
              className="flex-1 px-3 py-2 rounded-lg text-sm text-slate-100 outline-none transition-all text-center"
              style={timeInputStyle}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.5)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)')}
            />
          </div>

          {/* 24h strip */}
          <div>
            <div
              className="relative h-2 rounded-full overflow-hidden"
              style={{ background: 'rgba(148,163,184,0.12)' }}
            >
              {bands.map((b, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full rounded-full"
                  style={{
                    left: `${b.left}%`,
                    width: `${b.width}%`,
                    background: 'linear-gradient(90deg, #22c55e, #4ade80)',
                    boxShadow: '0 0 8px rgba(34,197,94,0.4)',
                  }}
                />
              ))}
            </div>
            <div className="flex justify-between mt-1 text-[9px]" style={{ color: '#475569' }}>
              <span>00:00</span>
              <span>06:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>24:00</span>
            </div>
          </div>

          <p className="text-[10px] leading-relaxed" style={{ color: '#475569' }}>
            Outside {hours.start}–{hours.end}{overnight ? ' (overnight)' : ''} medic locations are visible
            only to coordinators — runners and other medics won&apos;t see them. Europe/Sofia time.
          </p>
        </div>
      ) : (
        <p className="text-[10px] leading-relaxed" style={{ color: '#475569' }}>
          Off — medic locations are visible to the team and runners at all times.
        </p>
      )}
    </div>
  )
}

function POISection({ title, pois }: { title: string; pois: PointOfInterest[] }) {
  const grouped = pois.reduce<Record<string, PointOfInterest[]>>((acc, p) => {
    const key = POI_CONFIGS.find(c => c.type === p.type)?.label || p.type
    acc[key] = [...(acc[key] || []), p]
    return acc
  }, {})

  if (pois.length === 0) return null

  return (
    <div className="mb-4">
      <div className="text-xs font-semibold mb-2" style={{ color: '#64748b' }}>{title}</div>
      <div className="space-y-1.5">
        {Object.entries(grouped).map(([label, items]) => {
          const config = POI_CONFIGS.find(c => c.label === label)!
          return (
            <div
              key={label}
              className="flex items-center gap-2.5 p-2.5 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold"
                style={{ background: config?.bg || '#1e293b', color: config?.color || '#fff' }}
              >
                {items.length}
              </div>
              <div className="text-sm font-medium text-slate-300 truncate">{label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
