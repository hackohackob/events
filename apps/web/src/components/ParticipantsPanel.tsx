'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp, ArrowDown, Layers, ChevronRight, ChevronDown,
  Phone, MapPin, Clock, Pill, AlertTriangle, Users, Droplet, HeartPulse, Crosshair,
} from 'lucide-react'
import { computeFreshness, type ParticipantLastLocation } from '@events/contracts'

/** Any of the four medical fields filled in. */
function hasMedical(p: ParticipantLastLocation): boolean {
  return Boolean(p.allergies || p.medications || p.bloodType || p.conditions)
}

type SortKey = 'name' | 'bib' | 'recent'

const FRESHNESS_COLOR: Record<string, string> = {
  fresh: '#22c55e',
  warning: '#f59e0b',
  stale: '#f97316',
  offline: '#64748b',
}

function timeAgo(iso?: string): string {
  if (!iso) return 'no fix yet'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 'no fix yet'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function recentMs(p: ParticipantLastLocation): number {
  return p.recordedAt ? new Date(p.recordedAt).getTime() : 0
}

export default function ParticipantsPanel({
  participants,
  onLocate,
  highlight,
}: {
  participants: ParticipantLastLocation[]
  /** Fly the map to a participant's last known location. */
  onLocate?: (p: ParticipantLastLocation) => void
  /** Expand + scroll to + flash a participant (e.g. their map dot was clicked). */
  highlight?: { userId: string; nonce: number } | null
}) {
  const [sortKey, setSortKey] = useState<SortKey>('bib')
  const [sortAsc, setSortAsc] = useState(true)
  const [grouped, setGrouped] = useState(false)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [flashId, setFlashId] = useState<string | null>(null)
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // React to a highlight request (map dot click / "show on map"): open the row,
  // un-collapse its track group, scroll it into view, and flash it briefly.
  useEffect(() => {
    if (!highlight) return
    const target = participants.find((p) => p.userId === highlight.userId)
    if (!target) return
    setExpandedRow(highlight.userId)
    const groupKey = target.trackLabel || 'No track'
    setCollapsedGroups((prev) => {
      if (!prev.has(groupKey)) return prev
      const next = new Set(prev)
      next.delete(groupKey)
      return next
    })
    setFlashId(highlight.userId)
    const t1 = setTimeout(() => {
      rowRefs.current.get(highlight.userId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 60)
    const t2 = setTimeout(() => setFlashId(null), 1600)
    return () => { clearTimeout(t1); clearTimeout(t2) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight?.nonce])

  const sorted = useMemo(() => {
    const dir = sortAsc ? 1 : -1
    return [...participants].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = (a.name ?? '').localeCompare(b.name ?? '')
      else if (sortKey === 'bib') cmp = (Number(a.bibNumber) || 0) - (Number(b.bibNumber) || 0)
      else cmp = recentMs(a) - recentMs(b)
      return cmp * dir
    })
  }, [participants, sortKey, sortAsc])

  const groups = useMemo(() => {
    if (!grouped) return null
    const map = new Map<string, ParticipantLastLocation[]>()
    for (const p of sorted) {
      const key = p.trackLabel || 'No track'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return Array.from(map.entries())
  }, [sorted, grouped])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v)
    // "Last fix" starts descending (latest fixes on top); text/number keys ascending.
    else { setSortKey(key); setSortAsc(key !== 'recent') }
  }

  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const allCollapsed = grouped && groups != null && collapsedGroups.size >= groups.length
  const setAllGroups = (collapse: boolean) =>
    setCollapsedGroups(collapse && groups ? new Set(groups.map(([k]) => k)) : new Set())

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => {
    const active = sortKey === k
    return (
      <button
        onClick={() => toggleSort(k)}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
        style={{
          color: active ? '#e2e8f0' : '#64748b',
          background: active ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${active ? 'rgba(34,197,94,0.25)' : 'rgba(148,163,184,0.08)'}`,
        }}
      >
        {label}
        {active && (sortAsc ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div
        className="flex items-center gap-2 flex-wrap px-4 py-3 sticky top-0 z-10"
        style={{ borderBottom: '1px solid rgba(148,163,184,0.08)', background: 'rgba(8,15,28,0.85)', backdropFilter: 'blur(8px)' }}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest mr-1" style={{ color: '#475569' }}>Sort</span>
        <SortBtn k="bib" label="BIB" />
        <SortBtn k="name" label="Name" />
        <SortBtn k="recent" label="Last fix" />
        <div className="flex-1" />
        <button
          onClick={() => setGrouped((v) => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
          style={{
            color: grouped ? '#e2e8f0' : '#64748b',
            background: grouped ? 'rgba(59,130,246,0.14)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${grouped ? 'rgba(59,130,246,0.3)' : 'rgba(148,163,184,0.08)'}`,
          }}
        >
          <Layers className="w-3.5 h-3.5" />
          Group by track
        </button>
      </div>

      {/* Count + expand/collapse all */}
      <div className="flex items-center justify-between px-4 py-2 text-xs" style={{ color: '#64748b' }}>
        <span className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          {participants.length} participant{participants.length === 1 ? '' : 's'}
        </span>
        {grouped && groups && groups.length > 0 && (
          <button
            onClick={() => setAllGroups(!allCollapsed)}
            className="font-semibold transition-colors hover:text-slate-300"
            style={{ color: '#475569' }}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {participants.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center" style={{ color: '#475569' }}>
            <Users className="w-8 h-8" style={{ color: '#334155' }} />
            <div className="text-sm font-medium">No registered participants yet</div>
            <div className="text-xs">Runners appear here once they register in the app.</div>
          </div>
        ) : grouped && groups ? (
          groups.map(([key, rows]) => {
            const collapsed = collapsedGroups.has(key)
            return (
              <div key={key} className="mb-2">
                <button
                  onClick={() => toggleGroup(key)}
                  className="flex items-center gap-2 w-full px-2 py-2 rounded-lg transition-colors hover:bg-white/5"
                >
                  {collapsed ? <ChevronRight className="w-4 h-4" style={{ color: '#64748b' }} /> : <ChevronDown className="w-4 h-4" style={{ color: '#64748b' }} />}
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">{key}</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8' }}>{rows.length}</span>
                </button>
                {!collapsed && (
                  <div className="space-y-1 mt-1">
                    {rows.map((p) => (
                      <ParticipantRow
                        key={p.userId}
                        p={p}
                        expanded={expandedRow === p.userId}
                        flash={flashId === p.userId}
                        rowRef={(el) => { if (el) rowRefs.current.set(p.userId, el); else rowRefs.current.delete(p.userId) }}
                        onToggle={() => setExpandedRow((id) => (id === p.userId ? null : p.userId))}
                        onLocate={onLocate}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })
        ) : (
          <div className="space-y-1 mt-1">
            {sorted.map((p) => (
              <ParticipantRow
                key={p.userId}
                p={p}
                expanded={expandedRow === p.userId}
                flash={flashId === p.userId}
                rowRef={(el) => { if (el) rowRefs.current.set(p.userId, el); else rowRefs.current.delete(p.userId) }}
                onToggle={() => setExpandedRow((id) => (id === p.userId ? null : p.userId))}
                onLocate={onLocate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ParticipantRow({ p, expanded, flash, rowRef, onToggle, onLocate }: {
  p: ParticipantLastLocation
  expanded: boolean
  flash?: boolean
  rowRef?: (el: HTMLDivElement | null) => void
  onToggle: () => void
  onLocate?: (p: ParticipantLastLocation) => void
}) {
  // Derive freshness live from the fix timestamp on every render (matching
  // timeAgo's live "ago" text) rather than trusting `p.freshness`, which is
  // computed once server-side at fetch time and goes stale between polls or
  // when a live update patches lat/lng/recordedAt without recomputing it.
  const dot = FRESHNESS_COLOR[computeFreshness(p.recordedAt)] ?? '#64748b'
  const hasLocation = p.lat != null && p.lng != null

  return (
    <div
      ref={rowRef}
      className="rounded-xl overflow-hidden transition-all"
      style={{
        background: flash ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${flash ? '#22c55e' : expanded ? 'rgba(34,197,94,0.25)' : 'rgba(148,163,184,0.07)'}`,
        boxShadow: flash ? '0 0 0 3px rgba(34,197,94,0.18)' : 'none',
      }}
    >
      {/* Preview */}
      <button onClick={onToggle} className="flex items-center gap-3 w-full px-3 py-2.5 text-left">
        <span
          className="flex-shrink-0 flex items-center justify-center w-11 h-9 rounded-lg font-mono font-black text-sm"
          style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.18)' }}
        >
          {p.bibNumber ?? '—'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-200 truncate">{p.name || 'Unknown'}</span>
            {hasMedical(p) && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#f59e0b' }} aria-label="Has medical info" />}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {p.trackLabel && (
              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.14)', color: '#60a5fa' }}>
                {p.trackLabel}
              </span>
            )}
            <span className="flex items-center gap-1 text-[11px]" style={{ color: '#64748b' }}>
              <Clock className="w-3 h-3" />
              {timeAgo(p.recordedAt)}
            </span>
          </div>
        </div>
        <span className="flex-shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
        <ChevronDown className="w-4 h-4 flex-shrink-0 transition-transform" style={{ color: '#475569', transform: expanded ? 'rotate(180deg)' : 'none' }} />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2" style={{ borderTop: '1px solid rgba(148,163,184,0.07)' }}>
          {p.phone ? (
            <a
              href={`tel:${p.phone}`}
              className="flex items-center gap-2 text-sm font-medium transition-colors hover:text-green-300"
              style={{ color: '#22c55e' }}
            >
              <Phone className="w-4 h-4" /> {p.phone}
            </a>
          ) : (
            <div className="flex items-center gap-2 text-sm" style={{ color: '#475569' }}>
              <Phone className="w-4 h-4" /> No phone on file
            </div>
          )}

          {hasMedical(p) && (
            <div className="flex flex-wrap gap-1.5">
              {p.bloodType && (
                <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-md font-semibold" style={{ background: 'rgba(239,68,68,0.18)', color: '#fca5a5' }}>
                  <Droplet className="w-3 h-3" /> {p.bloodType}
                </span>
              )}
              {p.allergies && (
                <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-md" style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5' }}>
                  <AlertTriangle className="w-3 h-3" /> {p.allergies}
                </span>
              )}
              {p.medications && (
                <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-md" style={{ background: 'rgba(168,85,247,0.12)', color: '#c4b5fd' }}>
                  <Pill className="w-3 h-3" /> {p.medications}
                </span>
              )}
              {p.conditions && (
                <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-md" style={{ background: 'rgba(245,158,11,0.12)', color: '#fcd34d' }}>
                  <HeartPulse className="w-3 h-3" /> {p.conditions}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 text-xs flex-wrap" style={{ color: '#64748b' }}>
            {hasLocation && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {p.lat!.toFixed(5)}, {p.lng!.toFixed(5)}
                {p.accuracy != null && ` (±${Math.round(p.accuracy)}m)`}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" /> {p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleTimeString() : '—'}
            </span>
            {hasLocation && onLocate && (
              <button
                onClick={() => onLocate(p)}
                className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.22)' }}
              >
                <Crosshair className="w-3.5 h-3.5" /> Show on map
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
