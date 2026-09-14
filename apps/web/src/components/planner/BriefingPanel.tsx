'use client'

import { useMemo, useState } from 'react'
import { Check, ClipboardCopy, Download, Printer, Waves } from 'lucide-react'
import type { PlanMedic } from '@events/contracts'
import type { ResolveOptions } from '@/lib/planner/schedule'
import {
  buildItinerary,
  formatDay,
  formatDuration,
  formatTime,
  itinerariesToCsv,
  itineraryToText,
} from '@/lib/planner/itinerary'

interface Props {
  medics: PlanMedic[]
  /** Built per medic, because a medic's sweeps are their own. */
  resolveOptionsFor: (medic: PlanMedic) => ResolveOptions
  eventTitle: string
}

/**
 * The deliverable. Everything above this panel exists so that this list is
 * right — it is what gets printed, pasted into the group chat and read out at
 * the briefing.
 */
export default function BriefingPanel({ medics, resolveOptionsFor, eventTitle }: Props) {
  const [copied, setCopied] = useState<string | null>(null)

  const itineraries = useMemo(
    () =>
      medics
        .filter(m => m.stations.length > 0 || (m.sweeperFor?.length ?? 0) > 0)
        .map(m => buildItinerary(m, resolveOptionsFor(m))),
    [medics, resolveOptionsFor],
  )

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(current => (current === key ? null : current)), 1600)
    } catch {
      setCopied(null)
    }
  }

  const allText = itineraries.map(it => itineraryToText(it, eventTitle)).join('\n\n───────────────\n\n')

  const downloadCsv = () => {
    const blob = new Blob([itinerariesToCsv(itineraries)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${eventTitle.replace(/[^\w-]+/g, '-').toLowerCase()}-deployment.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (itineraries.length === 0) {
    return (
      <p className="text-xs text-center p-6" style={{ color: '#64748b' }}>
        Post a few medics on the map and their call sheets appear here, ready to print or paste.
      </p>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-2">
        <button
          onClick={() => copy('all', allText)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-[0.98]"
          style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8' }}
        >
          {copied === 'all' ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
          {copied === 'all' ? 'Copied' : 'Copy all'}
        </button>
        <button
          onClick={downloadCsv}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.15)', color: '#94a3b8' }}
        >
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.15)', color: '#94a3b8' }}
          title="Print all call sheets"
        >
          <Printer className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="planner-print space-y-3">
        {itineraries.map(it => (
          <div
            key={it.planMedicId}
            className="rounded-2xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${it.color}33` }}
          >
            <div
              className="flex items-center gap-2 px-3 py-2.5"
              style={{ background: `linear-gradient(90deg, ${it.color}1f, transparent)` }}
            >
              <span className="text-base">{it.vehicleIcon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate" style={{ color: '#e2e8f0' }}>{it.name}</div>
                <div className="text-[10px]" style={{ color: '#64748b' }}>
                  starts on {it.vehicleLabel}
                  {it.unit ? ` · ${it.unit}` : ''} · {it.stops.length} stops ·{' '}
                  {formatDuration(it.travelMinutes)} travelling
                  {it.swaps.length > 0 && ` · ${it.swaps.length} vehicle swap${it.swaps.length > 1 ? 's' : ''}`}
                </div>
              </div>
              <button
                onClick={() => copy(it.planMedicId, itineraryToText(it, eventTitle))}
                className="p-1.5 rounded-lg no-print"
                style={{ color: copied === it.planMedicId ? '#34d399' : '#475569' }}
                title="Copy this call sheet"
              >
                {copied === it.planMedicId ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
              </button>
            </div>

            <div className="px-3 pb-3 pt-1">
              {it.stops.map((stop, i) => {
                const showDay = i === 0 || formatDay(stop.arriveMs) !== formatDay(it.stops[i - 1].arriveMs)
                // Swaps live on the same clock as the stops; they are printed
                // just before the stop they precede so the sheet reads in order.
                const swapsBefore = it.swaps.filter(
                  s =>
                    s.atMs <= stop.arriveMs &&
                    (i === 0 || s.atMs > it.stops[i - 1].arriveMs),
                )
                const sweeping = stop.kind !== 'post'
                const title =
                  stop.kind === 'sweep-start'
                    ? stop.sweepJoin === 'post'
                      ? `Last runner reaches you — go with them (${stop.label.replace(/ tail$/, '')})`
                      : `Start sweeping ${stop.label.replace(/ start$/, '')}`
                    : stop.kind === 'sweep-end'
                      ? `Sweep complete — ${stop.label.replace(/ finish$/, '')}`
                      : `${i === 0 ? 'Be at ' : 'Move to '}${stop.label}`
                return (
                  <div key={stop.stationId}>
                    {showDay && (
                      <div
                        className="text-[9px] font-black uppercase tracking-widest mt-2 mb-1.5"
                        style={{ color: '#38bdf8' }}
                      >
                        {formatDay(stop.arriveMs)}
                      </div>
                    )}
                    {swapsBefore.map(swap => (
                      <div key={swap.atMs} className="flex gap-2.5 pb-2">
                        <span
                          className="text-[11px] font-black tabular-nums flex-shrink-0 text-center"
                          style={{ width: 40, color: '#94a3b8' }}
                        >
                          {formatTime(swap.atMs)}
                        </span>
                        <span className="text-[11px] font-bold" style={{ color: '#fbbf24' }}>
                          {swap.icon} Switch to {swap.label}
                        </span>
                      </div>
                    ))}
                    <div className="flex gap-2.5">
                      <div className="flex flex-col items-center flex-shrink-0" style={{ width: 40 }}>
                        <span className="text-[11px] font-black tabular-nums" style={{ color: '#e2e8f0' }}>
                          {formatTime(stop.arriveMs)}
                        </span>
                        {i < it.stops.length - 1 && (
                          <span
                            className="flex-1 w-px my-1"
                            style={{
                              background: sweeping ? it.color : `${it.color}44`,
                              minHeight: 14,
                            }}
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pb-2">
                        <div className="text-xs font-bold flex items-center gap-1.5" style={{ color: '#cbd5e1' }}>
                          {sweeping && <Waves className="w-3 h-3 flex-shrink-0" style={{ color: it.color }} />}
                          <span style={{ color: sweeping ? it.color : undefined }}>{title}</span>
                        </div>
                        {stop.note && (
                          <div className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>{stop.note}</div>
                        )}
                        <div className="text-[10px] mt-0.5" style={{ color: '#64748b' }}>
                          {stop.kind === 'sweep-start'
                            ? `Stay with the last participant · ${formatDuration(stop.dwellMinutes ?? 0)} on course`
                            : stop.handsOverToSweep && stop.departMs != null
                              ? `On station ${formatDuration(stop.dwellMinutes ?? 0)} · tail arrives ${formatTime(stop.departMs)}`
                            : stop.departMs != null
                              ? (stop.dwellMinutes ?? 0) < 1
                                // Nothing to wait for: the next leg needs every
                                // minute, so they turn around on arrival.
                                ? `Straight on — leave ${formatTime(stop.departMs)}`
                                : `On station ${formatDuration(stop.dwellMinutes ?? 0)} · leave ${formatTime(stop.departMs)}`
                              : 'Hold until stand-down'}
                          {stop.travelMinutes > 0
                            ? ` · ${stop.vehicleIcon ?? ''} ${formatDuration(stop.travelMinutes)} to get here`
                            : ''}
                        </div>
                        {stop.tight && (
                          <div className="text-[10px] font-bold mt-0.5" style={{ color: '#f87171' }}>
                            Not enough time — short by {formatDuration(stop.shortfallMinutes ?? 0)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
