'use client'

import { useState } from 'react'
import { Search, Plus, Filter, X, Mail, Phone, Check, Loader2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchUsers, createUser, updateUser, deleteUser } from '@/api/users'
import type { CreateUserPayload } from '@/api/users'
import { getInitials } from '@/lib/utils'
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

const ROLES: User['role'][] = ['paramedic', 'emt', 'doctor', 'coordinator', 'admin']

interface UserFormState {
  name: string
  email: string
  phone: string
  role: User['role']
  unit: string
  status: 'active' | 'inactive'
}

const EMPTY_FORM: UserFormState = {
  name: '',
  email: '',
  phone: '',
  role: 'paramedic',
  unit: '',
  status: 'active',
}

function inputStyle(focused: boolean) {
  return {
    background: 'rgba(255,255,255,0.05)',
    border: `1px solid ${focused ? 'rgba(34,197,94,0.5)' : 'rgba(148,163,184,0.12)'}`,
  }
}

interface UserModalProps {
  editingUser: User | null
  onSave: (data: UserFormState) => Promise<void>
  onClose: () => void
  saving: boolean
}

function UserModal({ editingUser, onSave, onClose, saving }: UserModalProps) {
  const [form, setForm] = useState<UserFormState>(
    editingUser
      ? { name: editingUser.name, email: editingUser.email, phone: editingUser.phone || '', role: editingUser.role, unit: editingUser.unit, status: editingUser.status }
      : EMPTY_FORM
  )
  const [focused, setFocused] = useState<string | null>(null)

  const set = (patch: Partial<UserFormState>) => setForm(f => ({ ...f, ...patch }))

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.email.trim()) return
    await onSave(form)
  }

  const labelClass = 'block text-xs font-semibold text-slate-400 mb-2'
  const inputClass = 'w-full px-3.5 py-2.5 rounded-xl text-sm text-slate-100 outline-none transition-all'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-5"
        style={{
          background: '#0a1424',
          border: '1px solid rgba(148,163,184,0.12)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-100">
            {editingUser ? 'Edit User' : 'Add New User'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className={labelClass}>Full Name <span style={{ color: '#ef4444' }}>*</span></label>
            <input
              value={form.name}
              onChange={e => set({ name: e.target.value })}
              placeholder="e.g. John Smith"
              className={inputClass}
              style={inputStyle(focused === 'name')}
              onFocus={() => setFocused('name')}
              onBlur={() => setFocused(null)}
            />
          </div>

          <div>
            <label className={labelClass}>Email <span style={{ color: '#ef4444' }}>*</span></label>
            <input
              type="email"
              value={form.email}
              onChange={e => set({ email: e.target.value })}
              placeholder="john@example.com"
              className={inputClass}
              style={inputStyle(focused === 'email')}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused(null)}
            />
          </div>

          <div>
            <label className={labelClass}>Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={e => set({ phone: e.target.value })}
              placeholder="+1 555-0100"
              className={inputClass}
              style={inputStyle(focused === 'phone')}
              onFocus={() => setFocused('phone')}
              onBlur={() => setFocused(null)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Role</label>
              <select
                value={form.role}
                onChange={e => set({ role: e.target.value as User['role'] })}
                className={inputClass + ' appearance-none cursor-pointer'}
                style={inputStyle(focused === 'role')}
                onFocus={() => setFocused('role')}
                onBlur={() => setFocused(null)}
              >
                {ROLES.map(r => (
                  <option key={r} value={r} style={{ background: '#0a1424' }}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Unit</label>
              <input
                value={form.unit}
                onChange={e => set({ unit: e.target.value })}
                placeholder="Unit 1"
                className={inputClass}
                style={inputStyle(focused === 'unit')}
                onFocus={() => setFocused('unit')}
                onBlur={() => setFocused(null)}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Status</label>
            <div className="flex gap-2">
              {(['active', 'inactive'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => set({ status: s })}
                  className="flex items-center gap-2 flex-1 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{
                    background: form.status === s ? (s === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(100,116,139,0.15)') : 'rgba(255,255,255,0.04)',
                    border: form.status === s ? (s === 'active' ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(100,116,139,0.4)') : '1px solid rgba(148,163,184,0.12)',
                    color: form.status === s ? (s === 'active' ? '#22c55e' : '#94a3b8') : '#64748b',
                  }}
                >
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: form.status === s ? (s === 'active' ? '#22c55e' : '#64748b') : 'rgba(100,116,139,0.4)' }}
                  />
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                  {form.status === s && <Check className="w-3.5 h-3.5 ml-auto" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.15)', color: '#94a3b8' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!form.name.trim() || !form.email.trim() || saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', boxShadow: '0 4px 14px rgba(34,197,94,0.3)' }}
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {editingUser ? 'Save Changes' : 'Add User'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function UsersPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
    staleTime: 30_000,
  })

  const createMutation = useMutation({
    mutationFn: (payload: CreateUserPayload) => createUser(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreateUserPayload> }) =>
      updateUser(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  const filtered = users.filter(u => {
    const matchSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'all' || u.role === roleFilter
    return matchSearch && matchRole
  })

  const openCreate = () => { setEditingUser(null); setModalOpen(true) }
  const openEdit = (u: User) => { setEditingUser(u); setModalOpen(true) }
  const closeModal = () => { setModalOpen(false); setEditingUser(null) }

  const saving = createMutation.isPending || updateMutation.isPending

  const handleSave = async (form: UserFormState) => {
    const payload: CreateUserPayload = {
      name: form.name,
      email: form.email,
      phone: form.phone || undefined,
      role: form.role,
      unit: form.unit,
      status: form.status,
    }
    if (editingUser) {
      await updateMutation.mutateAsync({ id: editingUser.id, payload })
    } else {
      await createMutation.mutateAsync(payload)
    }
    closeModal()
  }

  const handleDelete = (userId: string) => {
    deleteMutation.mutate(userId)
  }

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
            {users.length} total · {users.filter(u => u.status === 'active').length} active
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-95"
          style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', boxShadow: '0 4px 14px rgba(34,197,94,0.35)' }}
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
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)' }}
            onFocus={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.4)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)')}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4" style={{ color: '#64748b' }} />
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="px-3 py-2.5 rounded-xl text-sm outline-none appearance-none cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)', color: '#94a3b8' }}
          >
            <option value="all">All Roles</option>
            {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
          </select>
        </div>
      </div>

      {/* User grid */}
      <div className="flex-1 p-8 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((user, i) => {
              const roleColor = ROLE_COLORS[user.role]
              return (
                <div
                  key={user.id}
                  className="rounded-2xl p-5 flex flex-col gap-4 transition-all duration-200 group relative"
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
                  <div className="flex items-start justify-between">
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center text-base font-bold text-white"
                      style={{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length] }}
                    >
                      {getInitials(user.name)}
                    </div>
                    <div
                      className="w-2 h-2 rounded-full mt-1"
                      style={{
                        background: user.status === 'active' ? '#22c55e' : '#64748b',
                        boxShadow: user.status === 'active' ? '0 0 6px rgba(34,197,94,0.6)' : 'none',
                      }}
                    />
                  </div>

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

                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEdit(user)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={{ background: 'rgba(255,255,255,0.07)', color: '#94a3b8' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(user.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.15)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <svg className="w-8 h-8 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div className="text-slate-400 font-medium">No users found</div>
            <div className="text-sm text-slate-600">Try adjusting your search or filters</div>
          </div>
        )}
      </div>

      {modalOpen && (
        <UserModal editingUser={editingUser} onSave={handleSave} onClose={closeModal} saving={saving} />
      )}
    </div>
  )
}
