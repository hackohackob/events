'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Calendar, Users, Settings, LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/events', icon: Calendar, label: 'Events' },
  { href: '/users', icon: Users, label: 'Users' },
  { href: '/settings', icon: Settings, label: 'Settings' },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside
      className="fixed left-0 top-0 h-full w-[200px] flex flex-col z-50"
      style={{
        background: 'linear-gradient(180deg, #0a1424 0%, #081020 100%)',
        borderRight: '1px solid rgba(148,163,184,0.08)',
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 mb-2">
        <Image src="/logo.png" alt="Logo" width={36} height={36} className="flex-shrink-0" />
        <div className="leading-tight">
          <div className="text-white font-bold text-sm tracking-wide">PARAMEDIC</div>
          <div className="text-xs font-medium" style={{ color: '#64748b' }}>EVENT APP</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== '/dashboard' && (pathname?.startsWith(href) ?? false))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group',
                active
                  ? 'text-white'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
              )}
              style={active ? {
                background: 'linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.08) 100%)',
                boxShadow: 'inset 0 0 0 1px rgba(34,197,94,0.2)',
              } : {}}
            >
              <Icon
                className={cn(
                  'w-[18px] h-[18px] flex-shrink-0 transition-colors',
                  active ? 'text-accent-green' : 'text-slate-600 group-hover:text-slate-400'
                )}
                style={active ? { color: '#22c55e' } : {}}
                strokeWidth={active ? 2.5 : 2}
              />
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>

      {/* User profile */}
      <div className="p-3 mt-2" style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}>
        <div className="flex items-center gap-3 px-3 py-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}
          >
            JS
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-200 truncate">John Staff</div>
            <div className="text-xs" style={{ color: '#64748b' }}>Administrator</div>
          </div>
        </div>
        <button
          className="flex items-center gap-2 w-full px-3 py-2 mt-1 rounded-lg text-sm transition-colors"
          style={{ color: '#64748b' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
          onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
        >
          <LogOut className="w-4 h-4" />
          <span>Log out</span>
        </button>
      </div>
    </aside>
  )
}
