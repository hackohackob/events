'use client'

import Link from 'next/link'
import { Calendar, Users, Activity, AlertTriangle, ArrowRight, TrendingUp } from 'lucide-react'
import { MOCK_EVENTS, MOCK_USERS } from '@/lib/mock-data'
import { formatShortDate } from '@/lib/utils'

const stats = [
  { label: 'Active Events', value: '2', change: '+1 this month', icon: Calendar, color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  { label: 'Total Medics', value: '47', change: '+3 this week', icon: Users, color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  { label: 'Disciplines', value: '14', change: 'across all events', icon: Activity, color: '#f97316', bg: 'rgba(249,115,22,0.1)' },
  { label: 'Open Incidents', value: '3', change: '2 in progress', icon: AlertTriangle, color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
]

export default function DashboardPage() {
  return (
    <div className="flex flex-col flex-1">
      <div
        className="px-8 py-5"
        style={{ borderBottom: '1px solid rgba(148,163,184,0.08)', background: 'rgba(12,21,39,0.6)' }}
      >
        <h1 className="text-xl font-bold text-slate-100">Dashboard</h1>
        <p className="text-sm mt-0.5" style={{ color: '#64748b' }}>Welcome back, John</p>
      </div>

      <div className="p-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          {stats.map(({ label, value, change, icon: Icon, color, bg }) => (
            <div
              key={label}
              className="rounded-2xl p-5"
              style={{ background: 'rgba(20,33,61,0.8)', border: '1px solid rgba(148,163,184,0.08)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: bg }}>
                  <Icon className="w-5 h-5" style={{ color }} />
                </div>
                <TrendingUp className="w-4 h-4" style={{ color: '#64748b' }} />
              </div>
              <div className="text-2xl font-bold text-slate-100">{value}</div>
              <div className="text-sm font-medium mt-0.5 text-slate-400">{label}</div>
              <div className="text-xs mt-1" style={{ color: '#64748b' }}>{change}</div>
            </div>
          ))}
        </div>

        {/* Recent Events */}
        <div className="rounded-2xl" style={{ background: 'rgba(20,33,61,0.8)', border: '1px solid rgba(148,163,184,0.08)' }}>
          <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
            <h2 className="font-bold text-slate-200">Recent Events</h2>
            <Link href="/events" className="flex items-center gap-1 text-sm transition-colors" style={{ color: '#22c55e' }}>
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y" style={{ borderColor: 'rgba(148,163,184,0.06)' }}>
            {MOCK_EVENTS.map(ev => (
              <div key={ev.id} className="flex items-center gap-4 p-5">
                <div
                  className="w-10 h-10 rounded-xl flex-shrink-0"
                  style={{ background: ev.image ? undefined : 'rgba(255,255,255,0.06)', overflow: 'hidden' }}
                >
                  {ev.image && <img src={ev.image} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-slate-200 truncate">{ev.title}</div>
                  <div className="text-xs mt-0.5 text-slate-500">{ev.location}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-medium text-slate-400">{ev.dates.map(d => formatShortDate(d)).join(' – ')}</div>
                  <div className="text-xs mt-0.5" style={{ color: ev.status === 'active' ? '#22c55e' : ev.status === 'draft' ? '#f59e0b' : '#64748b' }}>
                    {ev.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
