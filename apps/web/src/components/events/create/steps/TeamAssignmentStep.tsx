'use client'

import { useState, useMemo } from 'react'
import { Search, ChevronLeft, ChevronRight, Trash2, Users, MapPin } from 'lucide-react'
import MapWrapper from '@/components/map/MapWrapper'
import type { EventFormData, MedicAssignment, VehicleType } from '@/lib/types'
import { MOCK_USERS } from '@/lib/mock-data'
import { VEHICLE_CONFIGS, MAP_CENTER, POI_CONFIGS } from '@/lib/constants'
import { getInitials } from '@/lib/utils'

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
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [unitFilter, setUnitFilter] = useState('all')

  const camps = useMemo(() => {
    const campTypes = ['base-medical-camp', 'second-medical-camp'] as const
    return data.pois
      .filter(p => campTypes.includes(p.type as typeof campTypes[number]))
      .map(p => POI_CONFIGS.find(c => c.type === p.type)?.label || p.type)
  }, [data.pois])

  const isAssigned = (userId: string) => data.assignments.some(a => a.userId === userId)

  const toggleUser = (userId: string) => {
    if (isAssigned(userId)) {
      update({ assignments: data.assignments.filter(a => a.userId !== userId) })
    } else {
      update({ assignments: [...data.assignments, { userId }] })
    }
  }

  const updateAssignment = (userId: string, patch: Partial<MedicAssignment>) => {
    update({
      assignments: data.assignments.map(a =>
        a.userId === userId ? { ...a, ...patch } : a
      ),
    })
  }

  const filteredUsers = MOCK_USERS.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'all' || u.role === roleFilter
    const matchUnit = unitFilter === 'all' || u.unit === unitFilter
    return matchSearch && matchRole && matchUnit
  })

  const assignedUsers = data.assignments.map(a => {
    const user = MOCK_USERS.find(u => u.id === a.userId)
    return { ...a, user }
  }).filter(a => a.user)

  const units = Array.from(new Set(MOCK_USERS.map(u => u.unit))).sort()

  const campsCovered = new Set(data.assignments.filter(a => a.camp).map(a => a.camp)).size
  const vehiclesAssigned = data.assignments.filter(a => a.vehicle).length

  // Medic map markers
  const medicPOIs = useMemo(() => {
    return assignedUsers.map((a, i) => ({
      id: `medic-${a.userId}`,
      type: 'medical-point' as const,
      coordinates: [
        MAP_CENTER[0] + (Math.random() - 0.5) * 0.06,
        MAP_CENTER[1] + (Math.random() - 0.5) * 0.04,
      ] as [number, number],
    }))
  }, [data.assignments.length])

  return (
    <div className="flex h-full">
      {/* Left: Medic list */}
      <div
        className="w-[280px] flex-shrink-0 flex flex-col h-full"
        style={{ borderRight: '1px solid rgba(148,163,184,0.08)', background: 'rgba(10,18,34,0.6)' }}
      >
        <div className="p-4 space-y-3 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-100">Team Assignment</h2>
          <p className="text-xs" style={{ color: '#64748b' }}>Assign medics to the event and choose their camp and vehicle.</p>

          <div className="text-xs font-semibold pt-1" style={{ color: '#64748b' }}>SELECT MEDICS</div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#64748b' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search medics..."
              className="w-full pl-8 pr-3 py-2 rounded-xl text-sm text-slate-200 outline-none"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(148,163,184,0.12)',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.4)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)')}
            />
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded-lg text-xs outline-none appearance-none cursor-pointer"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)', color: '#94a3b8' }}
            >
              <option value="all">All Roles</option>
              <option value="paramedic">Paramedic</option>
              <option value="emt">EMT</option>
              <option value="doctor">Doctor</option>
              <option value="coordinator">Coordinator</option>
            </select>
            <select
              value={unitFilter}
              onChange={e => setUnitFilter(e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded-lg text-xs outline-none appearance-none cursor-pointer"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)', color: '#94a3b8' }}
            >
              <option value="all">All Units</option>
              {units.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>

        {/* Medic list */}
        <div className="flex-1 overflow-y-auto px-4 space-y-1.5 pb-4">
          {filteredUsers.map((user, i) => {
            const assigned = isAssigned(user.id)
            return (
              <div
                key={user.id}
                className="flex items-center gap-2.5 p-2.5 rounded-xl cursor-pointer transition-all group"
                style={{
                  background: assigned ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.03)',
                  border: assigned ? '1px solid rgba(34,197,94,0.25)' : '1px solid rgba(148,163,184,0.06)',
                }}
                onClick={() => toggleUser(user.id)}
              >
                {/* Checkbox */}
                <div
                  className="w-4.5 h-4.5 rounded flex items-center justify-center flex-shrink-0 transition-all"
                  style={{
                    width: 18,
                    height: 18,
                    background: assigned ? '#22c55e' : 'transparent',
                    border: assigned ? '1.5px solid #22c55e' : '1.5px solid rgba(148,163,184,0.3)',
                  }}
                >
                  {assigned && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>

                {/* Avatar */}
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                  style={{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length] }}
                >
                  {getInitials(user.name)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-200 truncate leading-tight">{user.name}</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[10px] font-semibold capitalize" style={{ color: ROLE_COLORS[user.role] || '#94a3b8' }}>
                      {user.role}
                    </span>
                    <span className="text-[10px]" style={{ color: '#475569' }}>· {user.unit}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Nav */}
        <div className="p-4 pt-0" style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}>
          <div
            className="flex items-center gap-2 mb-3 text-xs"
            style={{ color: '#64748b' }}
          >
            <Users className="w-3.5 h-3.5" style={{ color: '#8b5cf6' }} />
            You can change assignments later.
          </div>
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
              Next Step <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Center: Assigned medics panel */}
      <div
        className="w-[300px] flex-shrink-0 flex flex-col h-full overflow-y-auto"
        style={{ borderRight: '1px solid rgba(148,163,184,0.08)', background: 'rgba(12,20,36,0.5)' }}
      >
        <div className="p-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">Selected ({data.assignments.length})</span>
            <button
              className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-all"
              style={{ color: '#22c55e', background: 'rgba(34,197,94,0.1)' }}
            >
              Bulk Assign
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {assignedUsers.map(({ user, userId, camp, vehicle }, i) => {
            if (!user) return null
            return (
              <div
                key={userId}
                className="rounded-2xl p-4 space-y-3"
                style={{
                  background: 'rgba(20,33,61,0.8)',
                  border: '1px solid rgba(148,163,184,0.08)',
                }}
              >
                {/* Header */}
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length] }}
                  >
                    {getInitials(user.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-200 truncate">{user.name}</div>
                    <div className="flex items-center gap-1 text-xs mt-0.5">
                      <span style={{ color: ROLE_COLORS[user.role] || '#94a3b8' }} className="capitalize font-medium">{user.role}</span>
                      <span style={{ color: '#475569' }}>· {user.unit}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleUser(userId)}
                    className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-slate-500 hover:text-red-400" />
                  </button>
                </div>

                {/* Camp */}
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#64748b' }}>
                    Camp (Optional)
                  </label>
                  <select
                    value={camp || ''}
                    onChange={e => updateAssignment(userId, { camp: e.target.value || undefined })}
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none appearance-none cursor-pointer"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(148,163,184,0.12)',
                      color: camp ? '#f1f5f9' : '#64748b',
                    }}
                  >
                    <option value="">Select camp...</option>
                    {camps.length > 0
                      ? camps.map(c => <option key={c} value={c}>{c}</option>)
                      : (
                        <>
                          <option value="Base Medical Camp">Base Medical Camp</option>
                          <option value="Second Medical Camp">Second Medical Camp</option>
                        </>
                      )
                    }
                  </select>
                </div>

                {/* Vehicle */}
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#64748b' }}>Vehicle</label>
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
                    <option value="">Select vehicle...</option>
                    {VEHICLE_CONFIGS.map(v => (
                      <option key={v.value} value={v.value}>{v.icon} {v.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}

          {assignedUsers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.04)' }}
              >
                <Users className="w-6 h-6 text-slate-600" />
              </div>
              <div className="text-sm text-slate-500 text-center">Select medics from the list on the left</div>
            </div>
          )}
        </div>

        {/* Stats */}
        <div
          className="flex items-center justify-around p-4"
          style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}
        >
          {[
            { label: 'Assigned Medics', value: data.assignments.length, color: '#8b5cf6' },
            { label: 'Camps Covered', value: campsCovered, color: '#22c55e' },
            { label: 'Vehicles Assigned', value: vehiclesAssigned, color: '#3b82f6' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <div className="text-xl font-bold" style={{ color }}>{value}</div>
              <div className="text-[10px] leading-tight mt-0.5" style={{ color: '#64748b' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Map */}
      <div className="flex-1 relative h-full">
        <MapWrapper
          center={MAP_CENTER}
          zoom={12}
          pois={[...data.pois, ...medicPOIs.slice(0, data.assignments.length)]}
        />
      </div>
    </div>
  )
}
