'use client'

import { useState, useMemo, useCallback } from 'react'
import { Search, ChevronLeft, ChevronRight, Trash2, Users, Copy } from 'lucide-react'
import MapWrapper from '@/components/map/MapWrapper'
import type { EventFormData, MedicAssignment, VehicleType } from '@/lib/types'
import type { MedicMarker } from '@/components/map/MapWrapper'
import { useQuery } from '@tanstack/react-query'
import { fetchUsers } from '@/api/users'
import { VEHICLE_CONFIGS, MAP_CENTER, POI_CONFIGS } from '@/lib/constants'
import { getInitials, computeTrackBounds } from '@/lib/utils'

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#3b82f6,#8b5cf6)',
  'linear-gradient(135deg,#22c55e,#14b8a6)',
  'linear-gradient(135deg,#f97316,#ef4444)',
  'linear-gradient(135deg,#8b5cf6,#ec4899)',
  'linear-gradient(135deg,#14b8a6,#3b82f6)',
  'linear-gradient(135deg,#f59e0b,#f97316)',
]

const ROLE_COLORS: Record<string, string> = {
  paramedic: '#22c55e',
  emt: '#3b82f6',
  doctor: '#f97316',
  coordinator: '#8b5cf6',
  admin: '#f59e0b',
}

interface Props {
  data: EventFormData
  update: (p: Partial<EventFormData>) => void
  onNext: () => void
  onBack: () => void
}

export default function TeamAssignmentStep({ data, update, onNext, onBack }: Props) {
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: fetchUsers })

  const [selectedDayId, setSelectedDayId] = useState(data.days[0]?.id || '')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [medicPositions, setMedicPositions] = useState<Record<string, [number, number]>>({})

  const selectedDay = data.days.find(d => d.id === selectedDayId) || data.days[0]
  const dayIndex = data.days.findIndex(d => d.id === selectedDayId)
  const multiDay = data.days.length > 1

  const currentAssignments = selectedDay?.assignments || []
  const currentPois = selectedDay?.pois || []

  const updateDayAssignments = useCallback((dayId: string, newAssignments: MedicAssignment[]) => {
    update({ days: data.days.map(d => d.id === dayId ? { ...d, assignments: newAssignments } : d) })
  }, [data.days, update])

  const copyFromDay = useCallback((sourceDayId: string) => {
    if (!selectedDay) return
    const sourceDay = data.days.find(d => d.id === sourceDayId)
    if (!sourceDay) return
    updateDayAssignments(selectedDay.id, [...sourceDay.assignments])
  }, [data.days, selectedDay, updateDayAssignments])

  const positionOptions = useMemo(() => {
    const campTypes = ['base-medical-camp', 'second-medical-camp']
    const fromPOIs = currentPois
      .filter(p => campTypes.includes(p.type))
      .map(p => p.name || POI_CONFIGS.find(c => c.type === p.type)?.label || p.type)
    return ['Mobile', ...fromPOIs]
  }, [currentPois])

  const campsByName = useMemo(() => {
    const map: Record<string, [number, number]> = {}
    currentPois
      .filter(p => ['base-medical-camp', 'second-medical-camp'].includes(p.type))
      .forEach(p => {
        const name = p.name || POI_CONFIGS.find(c => c.type === p.type)?.label || p.type
        map[name] = p.coordinates
      })
    return map
  }, [currentPois])

  const dayTracks = useMemo(() => {
    const day = data.days.find(d => d.id === selectedDayId)
    return (day?.disciplines || []).map(disc => ({
      id: disc.id,
      name: disc.name,
      color: disc.color,
      coordinates: disc.gpxCoordinates?.length ? disc.gpxCoordinates : [],
    })).filter(t => t.coordinates.length > 0)
  }, [data.days, selectedDayId])

  const trackBounds = useMemo(() => computeTrackBounds(dayTracks), [dayTracks])

  const mapCenter = trackBounds?.center || (currentPois[0]?.coordinates) || MAP_CENTER

  const isAssigned = (userId: string) => currentAssignments.some(a => a.userId === userId)

  const toggleUser = (userId: string) => {
    if (!selectedDay) return
    if (isAssigned(userId)) {
      updateDayAssignments(selectedDay.id, currentAssignments.filter(a => a.userId !== userId))
    } else {
      updateDayAssignments(selectedDay.id, [...currentAssignments, { userId }])
    }
  }

  const updateAssignment = (userId: string, patch: Partial<MedicAssignment>) => {
    if (!selectedDay) return
    updateDayAssignments(selectedDay.id, currentAssignments.map(a => a.userId === userId ? { ...a, ...patch } : a))
  }

  const filteredUsers = users.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'all' || u.role === roleFilter
    return matchSearch && matchRole
  })

  const assignedUsers = currentAssignments.map(a => {
    const user = users.find(u => u.id === a.userId)
    return { ...a, user }
  }).filter(a => a.user)

  const vehiclesAssigned = currentAssignments.filter(a => a.vehicle).length
  const positionsCovered = new Set(currentAssignments.filter(a => a.position).map(a => a.position)).size

  const medicMapMarkers: MedicMarker[] = useMemo(() => {
    return assignedUsers.map((a, i) => {
      if (medicPositions[a.userId]) {
        return {
          id: `medic-${a.userId}`,
          longitude: medicPositions[a.userId][0],
          latitude: medicPositions[a.userId][1],
          initials: getInitials(a.user!.name),
          gradient: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length],
          imageUrl: a.user!.avatar,
          draggable: true,
        }
      }
      const campCoords = a.position ? campsByName[a.position] : undefined
      let lng: number, lat: number
      if (campCoords) {
        const angle = (i * 137.5 * Math.PI) / 180
        const radius = 0.002 + (i % 3) * 0.001
        lng = campCoords[0] + Math.cos(angle) * radius
        lat = campCoords[1] + Math.sin(angle) * radius
      } else {
        const angle = (i * 137.5 * Math.PI) / 180
        const radius = 0.015 + (Math.floor(i / 8) * 0.008)
        lng = mapCenter[0] + Math.cos(angle) * radius
        lat = mapCenter[1] + Math.sin(angle) * radius
      }
      return {
        id: `medic-${a.userId}`,
        longitude: lng,
        latitude: lat,
        initials: getInitials(a.user!.name),
        gradient: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length],
        imageUrl: a.user!.avatar,
        draggable: true,
      }
    })
  }, [assignedUsers.length, assignedUsers.map(a => a.position).join(','), campsByName, medicPositions, mapCenter])

  const handleMedicMove = useCallback((id: string, coords: [number, number]) => {
    const userId = id.replace('medic-', '')
    setMedicPositions(prev => ({ ...prev, [userId]: coords }))
  }, [])

  return (
    <div className="flex h-full">
      {/* Left: Medic selector */}
      <div
        className="w-[260px] flex-shrink-0 flex flex-col h-full"
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
              const count = day.assignments.length
              return (
                <button
                  key={day.id}
                  onClick={() => setSelectedDayId(day.id)}
                  className="flex-shrink-0 flex flex-col items-center gap-0.5 px-3 pb-2.5 pt-2 rounded-t-xl transition-all"
                  style={{
                    background: isActive ? 'rgba(139,92,246,0.08)' : 'transparent',
                    borderBottom: isActive ? '2px solid #8b5cf6' : '2px solid transparent',
                    color: isActive ? '#8b5cf6' : '#64748b',
                  }}
                >
                  <span className="text-xs font-bold">Day {i + 1}</span>
                  <span className="text-[10px]">{day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  {count > 0 && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        <div className="p-4 space-y-3 flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-slate-100">Medics</h2>
            <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
              {multiDay ? `Assigning for Day ${dayIndex + 1}` : 'Select medics for this event'}
            </p>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#64748b' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search medics..."
              className="w-full pl-8 pr-3 py-2 rounded-xl text-sm text-slate-200 outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)' }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(139,92,246,0.4)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)')}
            />
          </div>

          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="w-full px-3 py-1.5 rounded-lg text-xs outline-none appearance-none cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)', color: '#94a3b8' }}
          >
            <option value="all">All Roles</option>
            <option value="paramedic">Paramedic</option>
            <option value="emt">EMT</option>
            <option value="doctor">Doctor</option>
            <option value="coordinator">Coordinator</option>
          </select>
        </div>

        <div className="flex-1 overflow-y-auto px-4 space-y-1.5 pb-4">
          {filteredUsers.map((user, i) => {
            const assigned = isAssigned(user.id)
            const assignedOnOtherDays = multiDay
              ? data.days.filter(d => d.id !== selectedDayId && d.assignments.some(a => a.userId === user.id)).length
              : 0
            return (
              <div
                key={user.id}
                className="flex items-center gap-2.5 p-2.5 rounded-xl cursor-pointer transition-all"
                style={{
                  background: assigned ? 'rgba(139,92,246,0.08)' : 'rgba(255,255,255,0.03)',
                  border: assigned ? '1px solid rgba(139,92,246,0.25)' : '1px solid rgba(148,163,184,0.06)',
                }}
                onClick={() => toggleUser(user.id)}
              >
                <div
                  className="rounded flex items-center justify-center flex-shrink-0 transition-all"
                  style={{
                    width: 16, height: 16,
                    background: assigned ? '#8b5cf6' : 'transparent',
                    border: assigned ? '1.5px solid #8b5cf6' : '1.5px solid rgba(148,163,184,0.3)',
                  }}
                >
                  {assigned && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                  style={{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length] }}
                >
                  {getInitials(user.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-200 truncate leading-tight">{user.name}</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[10px] font-semibold capitalize" style={{ color: ROLE_COLORS[user.role] || '#94a3b8' }}>{user.role}</span>
                    {assignedOnOtherDays > 0 && (
                      <span className="text-[9px] px-1 rounded" style={{ background: 'rgba(148,163,184,0.1)', color: '#64748b' }}>
                        +{assignedOnOtherDays}d
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="p-4 pt-0 flex-shrink-0" style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}>
          <div className="flex gap-2">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.15)', color: '#94a3b8' }}
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={onNext}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg,#22c55e 0%,#16a34a 100%)', boxShadow: '0 4px 14px rgba(34,197,94,0.3)' }}
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Center: Assigned medics for this day */}
      <div
        className="w-[290px] flex-shrink-0 flex flex-col h-full"
        style={{ borderRight: '1px solid rgba(148,163,184,0.08)', background: 'rgba(12,20,36,0.5)' }}
      >
        <div className="p-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">
              {multiDay ? `Day ${dayIndex + 1} Team` : 'Assigned Team'}
            </span>
            <div className="flex items-center gap-2">
              {multiDay && dayIndex > 0 && (
                <div className="relative group">
                  <button
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-all"
                    style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', color: '#a78bfa' }}
                  >
                    <Copy className="w-3 h-3" />
                    Copy from
                  </button>
                  <div
                    className="absolute right-0 top-full mt-1 rounded-xl overflow-hidden hidden group-hover:flex flex-col"
                    style={{
                      background: 'rgba(10,18,34,0.98)', border: '1px solid rgba(148,163,184,0.15)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 20, minWidth: 120,
                    }}
                  >
                    {data.days.filter((_, i) => i !== dayIndex).map((day, _, arr) => {
                      const srcIdx = data.days.findIndex(d => d.id === day.id)
                      return (
                        <button
                          key={day.id}
                          onClick={() => copyFromDay(day.id)}
                          className="flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left"
                          style={{ color: '#94a3b8', borderBottom: arr.indexOf(day) < arr.length - 1 ? '1px solid rgba(148,163,184,0.06)' : undefined }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.12)'; e.currentTarget.style.color = '#a78bfa' }}
                          onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.color = '#94a3b8' }}
                        >
                          Day {srcIdx + 1}
                          <span style={{ color: '#64748b' }}>({day.assignments.length})</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}
              >
                {currentAssignments.length}
              </span>
            </div>
          </div>
          {multiDay && (
            <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
              {selectedDay?.date.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' })}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {assignedUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <Users className="w-6 h-6 text-slate-600" />
              </div>
              <div className="text-sm text-slate-500 text-center leading-relaxed">
                Select medics from<br />the list on the left
              </div>
            </div>
          ) : (
            assignedUsers.map(({ user, userId, position, vehicle, description }, i) => {
              if (!user) return null
              return (
                <div
                  key={userId}
                  className="rounded-2xl p-4 space-y-3"
                  style={{ background: 'rgba(20,33,61,0.8)', border: '1px solid rgba(148,163,184,0.08)' }}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 overflow-hidden"
                      style={{ background: user.avatar ? undefined : AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length] }}
                    >
                      {user.avatar ? <img src={user.avatar} alt="" className="w-full h-full object-cover" /> : getInitials(user.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-200 truncate">{user.name}</div>
                      <div className="text-xs capitalize" style={{ color: ROLE_COLORS[user.role] || '#94a3b8' }}>{user.role}</div>
                    </div>
                    <button
                      onClick={() => toggleUser(userId)}
                      className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-slate-500 hover:text-red-400" />
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: '#64748b' }}>Position</label>
                    <select
                      value={position || ''}
                      onChange={e => updateAssignment(userId, { position: e.target.value || undefined })}
                      className="w-full px-3 py-2 rounded-xl text-sm outline-none appearance-none cursor-pointer"
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(148,163,184,0.12)',
                        color: position ? '#f1f5f9' : '#64748b',
                      }}
                    >
                      <option value="">Select position...</option>
                      {positionOptions.map((pos, i) => <option key={`${pos}-${i}`} value={pos}>{pos}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: '#64748b' }}>Vehicle</label>
                    <select
                      value={vehicle || ''}
                      onChange={e => updateAssignment(userId, { vehicle: e.target.value as VehicleType || undefined })}
                      className="w-full px-3 py-2 rounded-xl text-sm outline-none appearance-none cursor-pointer"
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(148,163,184,0.12)',
                        color: vehicle ? '#f1f5f9' : '#64748b',
                      }}
                    >
                      <option value="">No vehicle</option>
                      {VEHICLE_CONFIGS.map(v => <option key={v.value} value={v.value}>{v.icon} {v.label}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: '#64748b' }}>Notes</label>
                    <input
                      value={description || ''}
                      onChange={e => updateAssignment(userId, { description: e.target.value || undefined })}
                      placeholder="e.g. Mobile on 10K, then 42K finish"
                      className="w-full px-3 py-2 rounded-xl text-sm text-slate-200 outline-none"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(148,163,184,0.12)' }}
                    />
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Stats */}
        <div
          className="flex items-center justify-around p-4 flex-shrink-0"
          style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}
        >
          {[
            { label: 'Assigned', value: currentAssignments.length, color: '#8b5cf6' },
            { label: 'Positions', value: positionsCovered, color: '#22c55e' },
            { label: 'Vehicles', value: vehiclesAssigned, color: '#3b82f6' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <div className="text-xl font-bold" style={{ color }}>{value}</div>
              <div className="text-[10px] mt-0.5" style={{ color: '#64748b' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Map */}
      <div className="flex-1 relative h-full">
        <MapWrapper
          center={mapCenter}
          zoom={12}
          pois={currentPois}
          tracks={dayTracks}
          medicMarkers={medicMapMarkers}
          onMedicMove={handleMedicMove}
          fitBounds={trackBounds?.bounds}
        />

        {/* Day summary chip */}
        {multiDay && (
          <div className="absolute top-4 left-4">
            <div
              className="flex gap-1"
              style={{ background: 'rgba(10,20,36,0.92)', backdropFilter: 'blur(8px)', borderRadius: '12px', border: '1px solid rgba(148,163,184,0.15)', padding: '4px' }}
            >
              {data.days.map((day, i) => (
                <button
                  key={day.id}
                  onClick={() => setSelectedDayId(day.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={{
                    background: day.id === selectedDayId ? 'rgba(139,92,246,0.2)' : 'transparent',
                    color: day.id === selectedDayId ? '#a78bfa' : '#64748b',
                    border: day.id === selectedDayId ? '1px solid rgba(139,92,246,0.3)' : '1px solid transparent',
                  }}
                >
                  Day {i + 1}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
