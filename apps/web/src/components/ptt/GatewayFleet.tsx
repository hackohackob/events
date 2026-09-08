'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Antenna, ArrowDownLeft, ArrowUpRight, Check, Loader2, RadioTower,
  RefreshCw, RotateCcw, Volume2, Wifi, WifiOff, Zap,
} from 'lucide-react'
import type { RadioGatewayCommandType, RadioGatewayStatus } from '@events/contracts'
import {
  commandRadioGateway, fetchGatewayTransmissions, fetchRadioGateways, updateRadioGateway,
} from '@/api/ptt'

/**
 * The radio gateway fleet — the boxes wired to handsets at the venues.
 *
 * The panel is built around one awkward fact: a gateway on a venue's WiFi
 * cannot be reached from here. Everything below is therefore an instruction
 * queued for the box's next check-in, and the UI says so rather than pretending
 * a button press did something immediately. "Bring back the setup WiFi" is the
 * important one — it is how somebody at the venue gets a phone back onto the
 * box after it has already joined the event network.
 */
export default function GatewayFleet({ events }: { events: Array<{ id: string; title: string }> }) {
  const qc = useQueryClient()
  const gateways = useQuery({
    queryKey: ['ptt', 'gateways'],
    queryFn: fetchRadioGateways,
    // Boxes report once a minute; polling faster only makes "last seen" tick.
    refetchInterval: 15_000,
  })

  if (gateways.isLoading) {
    return (
      <section className="rounded-2xl p-6 flex items-center gap-2 text-sm"
        style={{ background: 'var(--bg-card)', border: '1px solid rgba(148,163,184,0.1)', color: '#64748b' }}>
        <Loader2 className="w-4 h-4 animate-spin" /> Looking for gateway boxes…
      </section>
    )
  }

  const rows = gateways.data ?? []

  return (
    <section
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(148,163,184,0.1)' }}
    >
      <div className="flex items-start gap-4 p-5">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.33)', color: '#a78bfa' }}
        >
          <RadioTower className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-slate-100">Gateway boxes</h2>
          <p className="text-[13px] mt-1 leading-relaxed" style={{ color: '#7d8ea4' }}>
            Each box is wired to one handset and bridges one event. They dial in every minute — anything you change
            here reaches them on their next check-in.
          </p>
        </div>
        <button
          onClick={() => void gateways.refetch()}
          className="p-2 rounded-lg transition-colors hover:bg-white/[0.04]"
          style={{ color: '#64748b' }}
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${gateways.isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 pb-6 pt-1">
          <div
            className="rounded-xl p-4 text-[13px] leading-relaxed"
            style={{ background: 'rgba(148,163,184,0.05)', border: '1px dashed rgba(148,163,184,0.2)', color: '#7d8ea4' }}
          >
            <strong className="text-slate-300 block mb-1">No boxes have checked in yet.</strong>
            Power one up, join its <code style={{ color: '#a78bfa' }}>EM-Radio-…</code> WiFi from a phone, and paste
            the gateway key above into its setup screen. It appears here within a minute.
          </div>
        </div>
      ) : (
        rows.map((gateway) => (
          <GatewayRow
            key={gateway.id}
            gateway={gateway}
            events={events}
            onChanged={() => void qc.invalidateQueries({ queryKey: ['ptt', 'gateways'] })}
          />
        ))
      )}
    </section>
  )
}

function GatewayRow({
  gateway,
  events,
  onChanged,
}: {
  gateway: RadioGatewayStatus
  events: Array<{ id: string; title: string }>
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [queued, setQueued] = useState<RadioGatewayCommandType | null>(null)

  const command = useMutation({
    mutationFn: ({ type, arg }: { type: RadioGatewayCommandType; arg?: string }) =>
      commandRadioGateway(gateway.id, type, arg),
    onSuccess: (_data, variables) => {
      setQueued(variables.type)
      onChanged()
      // The confirmation is about the queue, not the box, so it should fade
      // rather than sit there implying the box has acted.
      setTimeout(() => setQueued(null), 6000)
    },
  })

  const patch = useMutation({
    mutationFn: (body: Parameters<typeof updateRadioGateway>[1]) => updateRadioGateway(gateway.id, body),
    onSuccess: onChanged,
  })

  const transmissions = useQuery({
    queryKey: ['ptt', 'gateways', gateway.id, 'tx'],
    queryFn: () => fetchGatewayTransmissions(gateway.id),
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  })

  const tone = gateway.online ? '#34d399' : '#f87171'
  const fault = gateway.audio.pttError

  return (
    <div style={{ borderTop: '1px solid rgba(148,163,184,0.07)' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3.5 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            gateway.audio.receiving || gateway.audio.transmitting ? 'ptt-node-live' : ''
          }`}
          style={{
            background: `${tone}1a`,
            border: `1px solid ${tone}44`,
            color: tone,
            ['--flow-glow' as string]: `${tone}55`,
          }}
        >
          <Antenna className="w-4 h-4" />
        </span>

        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <strong className="text-[15px] font-semibold text-slate-100">{gateway.name}</strong>
            <StatusChip online={gateway.online} />
            {fault && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                style={{ background: 'rgba(248,113,113,0.14)', color: '#f87171' }}>
                <AlertTriangle className="w-3 h-3" /> Keying fault
              </span>
            )}
          </span>
          <span className="block text-[12.5px] mt-0.5 truncate" style={{ color: '#64748b' }}>
            {gateway.eventName ?? 'No event assigned'} · {describeNetwork(gateway)} · seen {relative(gateway.lastSeenAt)}
          </span>
        </span>

        <span className="flex items-center gap-3 flex-shrink-0 text-[12px]" style={{ color: '#64748b' }}>
          <span className="inline-flex items-center gap-1" title="Received from the radio">
            <ArrowDownLeft className="w-3.5 h-3.5" style={{ color: '#34d399' }} />
            {gateway.counters.inbound}
          </span>
          <span className="inline-flex items-center gap-1" title="Sent to the radio">
            <ArrowUpRight className="w-3.5 h-3.5" style={{ color: '#fbbf24' }} />
            {gateway.counters.outbound}
          </span>
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          {gateway.netMode === 'ap' && (
            <Notice tone="#fbbf24">
              This box is in setup mode, serving its own WiFi. It is not on the venue network, so it is not bridging
              anything right now.
            </Notice>
          )}
          {fault && <Notice tone="#f87171">{fault}</Notice>}
          {gateway.health.queued > 0 && (
            <Notice tone="#fbbf24">
              {gateway.health.queued} transmission{gateway.health.queued === 1 ? '' : 's'} recorded while the box was
              offline, still waiting to be uploaded.
            </Notice>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden"
            style={{ background: 'rgba(148,163,184,0.1)' }}>
            <Stat label="Keying" value={gateway.audio.pttBackend} />
            <Stat label="Signal" value={gateway.signal ? `${gateway.signal}%` : '—'} />
            <Stat label="CPU" value={gateway.health.cpuTempC ? `${Math.round(gateway.health.cpuTempC)}°C` : '—'} />
            <Stat label="Version" value={gateway.version} />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: '#64748b' }}>
                Bridges this event
              </span>
              <select
                value={gateway.eventId ?? ''}
                onChange={(e) => patch.mutate({ eventId: e.target.value || null })}
                className="w-full px-3 py-2.5 rounded-xl text-[13.5px] outline-none"
                style={{ background: 'var(--bg-1)', border: '1px solid rgba(148,163,184,0.14)', color: '#f1f5f9' }}
              >
                <option value="">Not assigned</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>{event.title}</option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                onClick={() => patch.mutate({ ttsEnabled: !gateway.ttsEnabled })}
                className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-[13.5px] transition-colors"
                style={{
                  background: gateway.ttsEnabled ? 'rgba(34,197,94,0.1)' : 'var(--bg-1)',
                  border: `1px solid ${gateway.ttsEnabled ? 'rgba(34,197,94,0.32)' : 'rgba(148,163,184,0.14)'}`,
                  color: gateway.ttsEnabled ? '#86efac' : '#94a3b8',
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <Volume2 className="w-4 h-4" /> Speak text over the air
                </span>
                {gateway.ttsEnabled ? <Check className="w-4 h-4" /> : <span className="text-[11px]">Off</span>}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Action
              icon={<Wifi className="w-3.5 h-3.5" />}
              label="Bring back the setup WiFi"
              hint="The box drops the venue network and serves its own again, so somebody can reach it from a phone."
              pending={command.isPending}
              done={queued === 'enter_ap'}
              onClick={() => command.mutate({ type: 'enter_ap' })}
            />
            <Action
              icon={<Zap className="w-3.5 h-3.5" />}
              label="Test transmit"
              hint="Puts a short chirp on the air so the cabling can be checked by ear."
              pending={command.isPending}
              done={queued === 'test_tx'}
              onClick={() => command.mutate({ type: 'test_tx' })}
            />
            <Action
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              label="Update"
              hint="Downloads and installs the latest published gateway release."
              pending={command.isPending}
              done={queued === 'update'}
              onClick={() => command.mutate({ type: 'update' })}
            />
            <Action
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              label="Reboot"
              hint="Full restart of the box. About a minute off the air."
              pending={command.isPending}
              done={queued === 'reboot'}
              danger
              onClick={() => {
                if (confirm(`Reboot ${gateway.name}? It will be off the air for about a minute.`)) {
                  command.mutate({ type: 'reboot' })
                }
              }}
            />
          </div>

          {queued && (
            <p className="text-[12px]" style={{ color: '#fbbf24' }}>
              Queued. The box will pick it up on its next check-in, within a minute.
            </p>
          )}

          {gateway.pending.length > 0 && (
            <p className="text-[12px]" style={{ color: '#64748b' }}>
              Waiting to be collected: {gateway.pending.map((c) => c.type.replace(/_/g, ' ')).join(', ')}
            </p>
          )}

          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
              Recent traffic
            </h3>
            {transmissions.isLoading ? (
              <p className="text-[13px]" style={{ color: '#64748b' }}>Loading…</p>
            ) : (transmissions.data ?? []).length === 0 ? (
              <p className="text-[13px]" style={{ color: '#64748b' }}>Nothing yet.</p>
            ) : (
              <div className="space-y-1">
                {(transmissions.data ?? []).slice(0, 8).map((row) => (
                  <div key={row.id} className="flex items-center gap-2.5 text-[12.5px] py-1.5 px-2.5 rounded-lg"
                    style={{ background: 'rgba(0,0,0,0.2)' }}>
                    {row.direction === 'rx' ? (
                      <ArrowDownLeft className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#34d399' }} />
                    ) : (
                      <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#fbbf24' }} />
                    )}
                    <span style={{ color: '#94a3b8' }}>{row.party ?? 'Radio'}</span>
                    <span style={{ color: '#475569' }}>{formatSeconds(row.durationMs)}</span>
                    <span className="flex-1 min-w-0 truncate" style={{ color: '#64748b' }}>{row.transcript ?? ''}</span>
                    <span style={{ color: '#475569' }}>
                      {new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusChip({ online }: { online: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
      style={{
        background: online ? 'rgba(52,211,153,0.12)' : 'rgba(148,163,184,0.1)',
        color: online ? '#34d399' : '#94a3b8',
      }}
    >
      {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
      {online ? 'Online' : 'Offline'}
    </span>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2.5 text-center" style={{ background: 'var(--bg-card)' }}>
      <div className="text-[13.5px] font-semibold text-slate-200 capitalize">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider mt-0.5" style={{ color: '#475569' }}>{label}</div>
    </div>
  )
}

function Notice({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed"
      style={{ background: `${tone}14`, border: `1px solid ${tone}3d`, color: tone }}>
      {children}
    </div>
  )
}

function Action({
  icon, label, hint, onClick, pending, done, danger,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
  pending?: boolean
  done?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={pending}
      title={hint}
      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12.5px] font-semibold transition-colors disabled:opacity-50"
      style={{
        background: done ? 'rgba(251,191,36,0.12)' : danger ? 'rgba(248,113,113,0.09)' : 'var(--bg-2)',
        border: `1px solid ${done ? 'rgba(251,191,36,0.35)' : danger ? 'rgba(248,113,113,0.28)' : 'rgba(148,163,184,0.14)'}`,
        color: done ? '#fbbf24' : danger ? '#fca5a5' : '#cbd5e1',
      }}
    >
      {done ? <Check className="w-3.5 h-3.5" /> : icon}
      {done ? 'Queued' : label}
    </button>
  )
}

/** Radio traffic is mostly short; rounding to whole seconds shows "0s" a lot. */
function formatSeconds(ms: number): string {
  const seconds = ms / 1000
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
}

function describeNetwork(gateway: RadioGatewayStatus): string {
  if (gateway.netMode === 'ap') return 'setup WiFi'
  if (gateway.ssid) return gateway.ssid
  return gateway.netMode
}

function relative(iso?: string): string {
  if (!iso) return 'never'
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (seconds < 90) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  return `${Math.round(seconds / 86400)} d ago`
}
