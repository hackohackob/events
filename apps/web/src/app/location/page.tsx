'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crosshair, Info, Loader2, LocateFixed, RefreshCw, Save, Smartphone } from 'lucide-react'
import type { LocationDiagRecord, LocationTuning } from '@events/contracts'
import { DEFAULT_LOCATION_TUNING } from '@events/contracts'
import { fetchEvents } from '@/api/events'
import {
  fetchLocationDiagSummary,
  fetchLocationDiagnostics,
  fetchLocationTuning,
  requestPreciseFix,
  saveLocationTuning,
  type MedicDiagSummary,
} from '@/api/location-diagnostics'

const CARD = {
  background: 'rgba(20,33,61,0.8)',
  border: '1px solid rgba(148,163,184,0.08)',
  backdropFilter: 'blur(8px)',
}
const INPUT = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(148,163,184,0.12)',
  color: '#cbd5e1',
}

function ago(iso: string | null): string {
  if (!iso) return '—'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.max(s, 0)}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function accuracyColor(acc: number | null | undefined, threshold: number): string {
  if (acc == null) return '#64748b'
  if (acc <= 30) return '#22c55e'
  if (acc <= threshold) return '#f59e0b'
  return '#f87171'
}

const KIND_LABEL: Record<string, string> = {
  inaccurate_fix: 'Vague fix',
  refine: 'Re-measure',
  locate: 'Center on me',
  one_shot: 'App open',
  remote_fix: 'Dashboard request',
  baseline: 'Baseline',
  tuning: 'Tuning',
  tracking: 'Tracking',
}

const LEVEL_COLOR: Record<string, string> = { info: '#60a5fa', warn: '#f59e0b', error: '#f87171' }

// ─── Tuning form ─────────────────────────────────────────────────────────────

type NumKey = 'inaccurateThresholdM' | 'retryTimeoutSec' | 'retryTargetAccuracyM' | 'retryCooldownSec' | 'baselineSampleMin'
type BoolKey = 'retryEnabled' | 'stationaryHighAccuracy' | 'diagnosticsEnabled'

const NUM_FIELDS: { key: NumKey; label: string; unit: string; help: string }[] = [
  { key: 'inaccurateThresholdM', label: 'Vague above', unit: 'm', help: 'A reported fix wider than this is logged and re-measured.' },
  { key: 'retryTargetAccuracyM', label: 'Re-measure target', unit: 'm', help: 'The GPS burst stops as soon as a fix is this good.' },
  { key: 'retryTimeoutSec', label: 'Burst length', unit: 's', help: 'Longest a re-measure may keep the GPS on.' },
  { key: 'retryCooldownSec', label: 'Re-measure cooldown', unit: 's', help: 'Minimum gap between automatic re-measures.' },
  { key: 'baselineSampleMin', label: 'Baseline sample', unit: 'min', help: 'Also log one ordinary fix this often (0 = off).' },
]

const BOOL_FIELDS: { key: BoolKey; label: string; help: string }[] = [
  { key: 'retryEnabled', label: 'Re-measure vague fixes', help: 'Run a short high-accuracy GPS burst after a vague fix and report the better one.' },
  { key: 'stationaryHighAccuracy', label: 'GPS while “On post”', help: 'On post normally uses Wi-Fi/cell only (cheap, ~100 m, much worse out in the open). On = GPS all the time, more battery.' },
  { key: 'diagnosticsEnabled', label: 'Upload diagnostics', help: 'Phones send the sampled log lines shown below.' },
]

function TuningCard() {
  const qc = useQueryClient()
  const { data: tuning, isLoading } = useQuery({ queryKey: ['location-tuning'], queryFn: fetchLocationTuning })
  const [draft, setDraft] = useState<LocationTuning>(DEFAULT_LOCATION_TUNING)
  useEffect(() => { if (tuning) setDraft(tuning) }, [tuning])

  const save = useMutation({
    mutationFn: () => saveLocationTuning(draft),
    onSuccess: (next) => qc.setQueryData(['location-tuning'], next),
  })
  const dirty = tuning != null && JSON.stringify({ ...tuning, updatedAt: undefined }) !== JSON.stringify({ ...draft, updatedAt: undefined })

  return (
    <div className="rounded-2xl p-5 flex flex-col gap-4" style={CARD}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-100">Phone settings</h2>
          <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
            {tuning ? `v${tuning.version}${tuning.updatedAt ? ` · saved ${ago(tuning.updatedAt)}` : ' · defaults'}` : '…'}
          </p>
        </div>
        <button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)' }}
        >
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save
        </button>
      </div>

      {isLoading ? (
        <Loader2 className="w-6 h-6 animate-spin text-slate-500 self-center my-6" />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {BOOL_FIELDS.map(f => (
              <label key={f.key} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft[f.key]}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-green-500"
                />
                <span>
                  <span className="block text-sm text-slate-200">{f.label}</span>
                  <span className="block text-xs leading-relaxed" style={{ color: '#64748b' }}>{f.help}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {NUM_FIELDS.map(f => (
              <label key={f.key} className="flex flex-col gap-1" title={f.help}>
                <span className="text-xs font-medium" style={{ color: '#94a3b8' }}>{f.label}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={draft[f.key]}
                    onChange={e => setDraft(d => ({ ...d, [f.key]: Number(e.target.value) }))}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={INPUT}
                  />
                  <span className="text-xs w-8" style={{ color: '#64748b' }}>{f.unit}</span>
                </div>
                <span className="text-[11px] leading-snug" style={{ color: '#475569' }}>{f.help}</span>
              </label>
            ))}
          </div>
          <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.18)' }}>
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#60a5fa' }} />
            <p className="text-xs leading-relaxed" style={{ color: '#94a3b8' }}>
              Phones pick changes up with their next background location report — no need to open the app.
              Fixes vaguer than 500 m are never written to location history.
            </p>
          </div>
          {save.isError && <p className="text-xs" style={{ color: '#f87171' }}>Save failed: {String((save.error as Error)?.message)}</p>}
        </>
      )}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LocationPage() {
  const qc = useQueryClient()
  const { data: events = [] } = useQuery({ queryKey: ['events'], queryFn: fetchEvents, staleTime: 60_000 })
  const [eventId, setEventId] = useState('')
  const [medicFilter, setMedicFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Poll faster for a couple of minutes after asking phones for a fix.
  const [fastUntil, setFastUntil] = useState(0)

  useEffect(() => {
    if (eventId || events.length === 0) return
    setEventId((events.find(e => e.status === 'active') ?? events[0]!).id)
  }, [events, eventId])

  const { data: tuning } = useQuery({ queryKey: ['location-tuning'], queryFn: fetchLocationTuning })
  const threshold = tuning?.inaccurateThresholdM ?? DEFAULT_LOCATION_TUNING.inaccurateThresholdM
  const refetchInterval = () => (Date.now() < fastUntil ? 5_000 : 30_000)

  const summary = useQuery({
    queryKey: ['location-diag-summary', eventId],
    queryFn: () => fetchLocationDiagSummary(eventId),
    enabled: !!eventId,
    refetchInterval,
  })
  const logs = useQuery({
    queryKey: ['location-diag', eventId, medicFilter, kindFilter, levelFilter],
    queryFn: () => fetchLocationDiagnostics(eventId, { medicId: medicFilter, kind: kindFilter, level: levelFilter, limit: 300 }),
    enabled: !!eventId,
    refetchInterval,
  })

  const nameOf = useMemo(() => {
    const m = new Map((summary.data ?? []).map(s => [s.medicId, s.name]))
    return (id: string, fallback: string | null) => m.get(id) ?? fallback ?? id
  }, [summary.data])

  const precise = useMutation({
    mutationFn: (medicId?: string) => requestPreciseFix(eventId, medicId),
    onSuccess: (r) => {
      setNotice(
        r.devices === 0
          ? 'No registered device to wake — that phone has not registered for push on this event.'
          : `Asked ${r.devices} device${r.devices === 1 ? '' : 's'} for a precise fix. Results land in the log within about 30 s (iPhones that were swiped away can't be woken).`,
      )
      setFastUntil(Date.now() + 2 * 60_000)
      qc.invalidateQueries({ queryKey: ['location-diag'] })
    },
    onError: (err) => setNotice(`Request failed: ${String((err as Error)?.message)}`),
  })

  return (
    <div className="flex flex-col flex-1">
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-8 py-5"
        style={{ borderBottom: '1px solid rgba(148,163,184,0.08)', background: 'rgba(12,21,39,0.6)', backdropFilter: 'blur(12px)' }}
      >
        <div>
          <h1 className="text-xl font-bold text-slate-100">Location accuracy</h1>
          <p className="text-sm mt-0.5" style={{ color: '#64748b' }}>
            Why a medic’s dot is vague, and how hard the phones try to fix it
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={eventId}
            onChange={e => { setEventId(e.target.value); setMedicFilter('') }}
            className="px-3 py-2.5 rounded-xl text-sm outline-none cursor-pointer"
            style={INPUT}
          >
            {events.map(e => (
              <option key={e.id} value={e.id} style={{ background: '#0a1424' }}>
                {e.title}{e.status === 'active' ? ' (active)' : ''}
              </option>
            ))}
          </select>
          <button
            onClick={() => precise.mutate(undefined)}
            disabled={!eventId || precise.isPending}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 disabled:opacity-40"
            style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80' }}
            title="Silent push to every medic seen in the last 24 h"
          >
            {precise.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
            Precise fix from all
          </button>
        </div>
      </div>

      {notice && (
        <div className="px-8 pt-4">
          <div className="flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-xs" style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)', color: '#94a3b8' }}>
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} style={{ color: '#64748b' }}>✕</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-5 px-8 py-5">
        <TuningCard />

        {/* Medics */}
        <div className="rounded-2xl overflow-hidden flex flex-col" style={CARD}>
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
            <h2 className="text-sm font-bold text-slate-100">Medics</h2>
            <span className="text-xs" style={{ color: '#64748b' }}>last 6 h · click a row to filter the log</span>
          </div>
          {summary.isLoading ? (
            <Loader2 className="w-6 h-6 animate-spin text-slate-500 self-center my-10" />
          ) : (summary.data ?? []).length === 0 ? (
            <div className="text-sm text-slate-500 text-center py-10">No medics have reported on this event</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs" style={{ color: '#64748b' }}>
                    <th className="px-5 py-2 font-medium">Medic</th>
                    <th className="px-3 py-2 font-medium">Last fix</th>
                    <th className="px-3 py-2 font-medium">Accuracy</th>
                    <th className="px-3 py-2 font-medium">Battery</th>
                    <th className="px-3 py-2 font-medium" title="Vague fixes logged in the last 6 h">Vague</th>
                    <th className="px-3 py-2 font-medium" title="Re-measures that got a good fix / didn't">Re-measure ✓/✗</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {(summary.data ?? []).map((m: MedicDiagSummary) => (
                    <tr
                      key={m.medicId}
                      onClick={() => setMedicFilter(f => (f === m.medicId ? '' : m.medicId))}
                      className="cursor-pointer transition-colors hover:bg-white/5"
                      style={{
                        borderTop: '1px solid rgba(148,163,184,0.06)',
                        background: medicFilter === m.medicId ? 'rgba(34,197,94,0.06)' : undefined,
                      }}
                    >
                      <td className="px-5 py-2.5">
                        <div className="font-semibold text-slate-100 truncate max-w-[220px]">{m.name ?? m.medicId}</div>
                        <div className="text-xs truncate max-w-[220px]" style={{ color: '#64748b' }}>
                          {[m.platform, m.appVersion && `v${m.appVersion}`, m.device].filter(Boolean).join(' · ') || 'no diagnostics yet'}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: '#94a3b8' }}>
                        {ago(m.lastFixAt)}
                        {m.status && <div style={{ color: '#475569' }}>{m.status}</div>}
                      </td>
                      <td className="px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: accuracyColor(m.lastAccuracy, threshold) }}>
                        {m.lastAccuracy != null ? `±${Math.round(m.lastAccuracy)} m` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: '#94a3b8' }}>
                        {m.battery != null ? `${Math.round(m.battery * 100)}%` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: m.inaccurate6h ? '#f59e0b' : '#475569' }}>{m.inaccurate6h}</td>
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                        <span style={{ color: '#22c55e' }}>{m.refineOk6h}</span>
                        <span style={{ color: '#475569' }}> / </span>
                        <span style={{ color: m.refineFail6h ? '#f87171' : '#475569' }}>{m.refineFail6h}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={e => { e.stopPropagation(); precise.mutate(m.medicId) }}
                          disabled={precise.isPending}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap disabled:opacity-40"
                          style={{ background: 'rgba(34,197,94,0.08)', color: '#4ade80' }}
                          title="Wake this phone and take a fresh high-accuracy fix"
                        >
                          <Crosshair className="w-3.5 h-3.5" /> Fix now
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Log */}
      <div className="px-8 pb-8 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold text-slate-100 mr-2">Diagnostics log</h2>
          {medicFilter && (
            <button onClick={() => setMedicFilter('')} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80' }}>
              {nameOf(medicFilter, null)} ✕
            </button>
          )}
          <select value={kindFilter} onChange={e => setKindFilter(e.target.value)} className="px-3 py-2 rounded-lg text-xs outline-none" style={INPUT}>
            <option value="" style={{ background: '#0a1424' }}>All kinds</option>
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k} style={{ background: '#0a1424' }}>{label}</option>
            ))}
          </select>
          <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)} className="px-3 py-2 rounded-lg text-xs outline-none" style={INPUT}>
            <option value="" style={{ background: '#0a1424' }}>All levels</option>
            <option value="warn" style={{ background: '#0a1424' }}>Warnings</option>
            <option value="error" style={{ background: '#0a1424' }}>Errors</option>
            <option value="info" style={{ background: '#0a1424' }}>Info</option>
          </select>
          <button onClick={() => { void logs.refetch(); void summary.refetch() }} className="p-2 rounded-lg" style={{ color: '#64748b' }} title="Refresh">
            <RefreshCw className={`w-4 h-4 ${logs.isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="rounded-2xl overflow-hidden" style={CARD}>
          {logs.isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>
          ) : (logs.data ?? []).length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-2">
              <Smartphone className="w-7 h-7 text-slate-600" />
              <div className="text-sm text-slate-500">Nothing logged yet</div>
              <div className="text-xs text-slate-600">Phones log vague fixes, re-measures and “center on me” presses here</div>
            </div>
          ) : (
            (logs.data ?? []).map((row: LocationDiagRecord, i) => (
              <div key={row.id} style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(148,163,184,0.06)' }}>
                <button
                  onClick={() => setExpanded(x => (x === row.id ? null : row.id))}
                  className="w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-white/5"
                >
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: LEVEL_COLOR[row.level] ?? '#64748b' }} />
                  <span className="text-xs tabular-nums w-[118px] flex-shrink-0" style={{ color: '#64748b' }}>
                    {new Date(row.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className="text-xs font-semibold w-[140px] truncate flex-shrink-0 text-slate-300">{nameOf(row.medicId, row.name)}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-md flex-shrink-0" style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8' }}>
                    {KIND_LABEL[row.kind] ?? row.kind}
                  </span>
                  <span className="text-xs truncate flex-1" style={{ color: row.level === 'info' ? '#cbd5e1' : LEVEL_COLOR[row.level] }}>{row.message}</span>
                  {row.accuracy != null && (
                    <span className="text-xs font-semibold flex-shrink-0" style={{ color: accuracyColor(row.accuracy, threshold) }}>
                      ±{Math.round(row.accuracy)} m
                    </span>
                  )}
                </button>
                {expanded === row.id && (
                  <div className="px-5 pb-3 pl-[30px] flex flex-col gap-2">
                    <div className="text-xs" style={{ color: '#64748b' }}>
                      {[row.platform, row.appVersion && `v${row.appVersion}`, row.device].filter(Boolean).join(' · ')}
                      {' · received '}{ago(row.receivedAt)}
                      {row.lat != null && row.lng != null && (
                        <>
                          {' · '}
                          <a
                            href={`https://www.openstreetmap.org/?mlat=${row.lat}&mlon=${row.lng}#map=16/${row.lat}/${row.lng}`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                            style={{ color: '#60a5fa' }}
                          >
                            {row.lat.toFixed(5)}, {row.lng.toFixed(5)}
                          </a>
                        </>
                      )}
                    </div>
                    {row.data && (
                      <pre className="text-[11px] leading-relaxed rounded-lg p-3 overflow-x-auto" style={{ background: 'rgba(0,0,0,0.25)', color: '#94a3b8' }}>
                        {JSON.stringify(row.data, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
