'use client'

import { useState } from 'react'
import { Search, Plus, Filter, MoreVertical, Phone, Mail, Shield, Activity } from 'lucide-react'
import { MOCK_USERS } from '@/lib/mock-data'
import { getInitials, cn } from '@/lib/utils'
import type { User } from '@/lib/types'

const ROLE_COLORS: Record<User['role'], { text: string; bg: string }> = {
  paramedic: { text: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  emt: { text: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  doctor: { text: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  coordinator: { text: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  admin: { text: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #3b82f6, #8b5cf6)',
  'linear-gradient(135deg, #22c55e, #14b8a6)',
  'linear-gradient(135deg, #f97316, #ef4444)',
  'linear-gradient(135deg, #8b5cf6, #ec4899)',
  'linear-gradient(135deg, #14b8a6, #3b82f6)',
  'linear-gradient(135deg, #f59e0b, #f97316)',
]

export default function UsersPage() {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [unitFilter, setUnitFilter] = useState<string>('all')

  const filtered = MOCK_USERS.filter(u => {
    const matchSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'all' || u.role === roleFilter
    const matchUnit = unitFilter === 'all' || u.unit === unitFilter
    return matchSearch && matchRole && matchUnit
  })

  const units = Array.from(new Set(MOCK_USERS.map(u => u.unit))).sort()

  return (
    <div className="flex flex-col flex-1">
      {/* Header */}
      <div
        className="flex items-center justify-between px-8 py-5"
        style={{
          borderBottom: '1px solid rgba(148,163,184,0.08)',
          background: 'rgba(12,21,39,0.6)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div>
          <h1 className="text-xl font-bold text-slate-100">Users</h1>
          <p className="text-sm mt-0.5" style={{ color: '#64748b' }}>
            {MOCK_USERS.length} total · {MOCK_USERS.filter(u => u.status === 'active').length} active
          </p>
        </div>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-95"
          style={{
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            boxShadow: '0 4px 14px rgba(34,197,94,0.35)',
          }}
        >
          <Plus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-8 py-4" style={{ borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#64748b' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search users..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-slate-200 outline-none transition-all"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(148,163,184,0.12)',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.4)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)')}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4" style={{ color: '#64748b' }} />
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="px-3 py-2.5 rounded-xl text-sm outline-none appearance-none pr-8 cursor-pointer"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(148,163,184,0.12)',
              color: '#94a3b8',
            }}
          >
            <option value="all">All Roles</option>
            <option value="paramedic">Paramedic</option>
            <option value="emt">EMT</option>
            <option value="doctor">Doctor</option>
            <option value="coordinator">Coordinator</option>
            <option value="admin">Admin</option>
          </select>
          <select
            value={unitFilter}
            onChange={e => setUnitFilter(e.target.value)}
            className="px-3 py-2.5 rounded-xl text-sm outline-none appearance-none pr-8 cursor-pointer"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(148,163,184,0.12)',
              color: '#94a3b8',
            }}
          >
            <option value="all">All Units</option>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>

      {/* User grid */}
      <div className="flex-1 p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((user, i) => {
            const roleColor = ROLE_COLORS[user.role]
            return (
              <div
                key={user.id}
                className="rounded-2xl p-5 flex flex-col gap-4 cursor-pointer transition-all duration-200 group"
                style={{
                  background: 'rgba(20,33,61,0.8)',
                  border: '1px solid rgba(148,163,184,0.08)',
                  backdropFilter: 'blur(8px)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.border = '1px solid rgba(148,163,184,0.2)'
                  e.currentTarget.style.transform = 'translateY(-2px)'
                  e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,0.3)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.border = '1px solid rgba(148,163,184,0.08)'
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                {/* Top row */}
                <div className="flex items-start justify-between">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center text-base font-bold text-white"
                    style={{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length] }}
                  >
                    {getInitials(user.name)}
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{
                        background: user.status === 'active' ? '#22c55e' : '#64748b',
                        boxShadow: user.status === 'active' ? '0 0 6px rgba(34,197,94,0.6)' : 'none',
                      }}
                    />
                    <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-white/10">
                      <MoreVertical className="w-4 h-4 text-slate-400" />
                    </button>
                  </div>
                </div>

                {/* Name & role */}
                <div>
                  <div className="font-semibold text-slate-100 text-sm">{user.name}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full capitalize"
                      style={{ color: roleColor.text, background: roleColor.bg }}
                    >
                      {user.role}
                    </span>
                    <span className="text-xs" style={{ color: '#64748b' }}>{user.unit}</span>
                  </div>
                </div>

                {/* Contact */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#64748b' }} />
                    <span className="text-xs truncate" style={{ color: '#94a3b8' }}>{user.email}</span>
                  </div>
                  {user.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#64748b' }} />
                      <span className="text-xs" style={{ color: '#94a3b8' }}>{user.phone}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              <Users className="w-8 h-8 text-slate-600" />
            </div>
            <div className="text-slate-400 font-medium">No users found</div>
            <div className="text-sm text-slate-600">Try adjusting your search or filters</div>
          </div>
        )}
      </div>
    </div>
  )
}

function Users({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}
