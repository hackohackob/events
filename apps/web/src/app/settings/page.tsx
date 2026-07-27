'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, Check, ChevronDown, Eye, EyeOff, Image as ImageIcon, Loader2,
  MapPin, Mic, Plus, Radio, RefreshCw, Send, Settings2, Trash2, Type, X, Zap,
} from 'lucide-react'
import type {
  PttChannelKind, PttConfigField, PttConnectionState, PttProviderInfo,
  PttProviderSettings, PttProviderStatus, PttRoute,
} from '@events/contracts'
import {
  fetchPttActivity, fetchPttOverview, fetchPttRoutes, sendPttTest,
  updatePttProvider, updatePttRoute,
} from '@/api/ptt'
import { fetchEvents } from '@/api/events'
import BridgeFlow, { CHANNEL_THEME } from '@/components/ptt/BridgeFlow'

const STATE_THEME: Record<PttConnectionState, { label: string; color: string; pulse: boolean }> = {
  online: { label: 'Connected', color: '#34d399', pulse: true },
  connecting: { label: 'Connecting', color: '#fbbf24', pulse: true },
  offline: { label: 'Offline', color: '#94a3b8', pulse: false },
  error: { label: 'Error', color: '#f87171', pulse: false },
  disabled: { label: 'Off', color: '#475569', pulse: false },
}

const CAPABILITY_ICONS = [
  { key: 'text', icon: Type, label: 'Text' },
  { key: 'voice', icon: Mic, label: 'Voice' },
  { key: 'image', icon: ImageIcon, label: 'Images' },
  { key: 'location', icon: MapPin, label: 'Locations' },
] as const

export default function SettingsPage() {
  const qc = useQueryClient()

  const overview = useQuery({
    queryKey: ['ptt', 'overview'],
    queryFn: fetchPttOverview,
    // The bridge reconnects on its own; polling keeps the status honest without
    // a dedicated socket subscription on a page nobody keeps open for long.
    refetchInterval: 5000,
  })
  const activity = useQuery({ queryKey: ['ptt', 'activity'], queryFn: fetchPttActivity, refetchInterval: 5000 })
  const events = useQuery({ queryKey: ['events'], queryFn: fetchEvents })

  const activeEvents = useMemo(
    () => (events.data ?? []).filter((e) => e.status === 'active'),
    [events.data],
  )

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['ptt'] })
  }

  return (
    <div className="flex-1 p-6 lg:p-8 max-w-[1180px] w-full mx-auto">
      <header className="mb-7">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)' }}
          >
            <Settings2 className="w-5 h-5" style={{ color: '#38bdf8' }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Settings</h1>
            <p className="text-sm" style={{ color: '#64748b' }}>
              Push-to-talk integrations — the server keeps one connection per network and bridges it into every active event.
            </p>
          </div>
        </div>
      </header>

      {overview.isLoading ? (
        <div className="flex items-center gap-2 text-sm py-16 justify-center" style={{ color: '#64748b' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading integrations…
        </div>
      ) : overview.isError ? (
        <ErrorCard onRetry={() => void overview.refetch()} />
      ) : (
        <div className="space-y-5">
          {(overview.data?.providers ?? []).map((provider) => (
            <ProviderCard
              key={provider.kind}
              provider={provider}
              settings={overview.data!.settings.find((s) => s.kind === provider.kind)!}
              status={overview.data!.statuses.find((s) => s.kind === provider.kind)!}
              onSaved={invalidate}
            />
          ))}

          <RoutingSection
            events={activeEvents}
            providers={overview.data?.providers ?? []}
            statuses={overview.data?.statuses ?? []}
          />

          <ActivityLog entries={activity.data ?? []} />
        </div>
      )}
    </div>
  )
}

// ── Provider card ────────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  settings,
  status,
  onSaved,
}: {
  provider: PttProviderInfo
  settings: PttProviderSettings
  status: PttProviderStatus
  onSaved: () => void
}) {
  const theme = CHANNEL_THEME[provider.kind]
  const stateTheme = STATE_THEME[status.state]
  const [open, setOpen] = useState(!status.configured && provider.available)
  const [form, setForm] = useState<Record<string, string>>({})
  const [clearedSecrets, setCleared] = useState<string[]>([])
  const [revealed, setRevealed] = useState<string[]>([])
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Reset the draft whenever the server's copy changes underneath us.
  useEffect(() => {
    setForm({ ...settings.config })
    setCleared([])
  }, [settings.updatedAt, settings.kind])

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updatePttProvider>[1]) => updatePttProvider(provider.kind, patch),
    onSuccess: onSaved,
  })

  const test = useMutation({
    mutationFn: () => sendPttTest(provider.kind),
    onSuccess: () => setTestResult({ ok: true, message: 'Test message sent to the channel.' }),
    onError: (err: unknown) =>
      setTestResult({ ok: false, message: (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not send — check the connection.' }),
  })

  const dirty =
    clearedSecrets.length > 0 ||
    provider.fields.some((f) => (form[f.key] ?? '') !== (settings.config[f.key] ?? ''))

  return (
    <section
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(148,163,184,0.1)' }}
    >
      {/* Head */}
      <div className="flex items-start gap-4 p-5">
        <div
          className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${status.state === 'online' ? 'ptt-node-live' : ''}`}
          style={{
            background: `${theme.color}1a`,
            border: `1px solid ${theme.color}55`,
            color: theme.color,
            ['--flow-glow' as string]: `${theme.color}55`,
          }}
        >
          <Radio className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-lg font-bold text-slate-100">{provider.label}</h2>
            <StatusPill theme={stateTheme} />
            {!provider.available && (
              <span
                className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md"
                style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8' }}
              >
                Coming soon
              </span>
            )}
          </div>
          <p className="text-[13px] mt-1 leading-relaxed" style={{ color: '#7d8ea4' }}>
            {provider.description}
          </p>

          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            {CAPABILITY_ICONS.map(({ key, icon: Icon, label }) => {
              const on = provider.capabilities[key]
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg"
                  title={on ? `${label} are carried over this channel` : `${label} are not supported here`}
                  style={{
                    background: on ? `${theme.color}12` : 'rgba(148,163,184,0.06)',
                    border: `1px solid ${on ? `${theme.color}33` : 'rgba(148,163,184,0.12)'}`,
                    color: on ? theme.color : '#5a6b80',
                  }}
                >
                  <Icon className="w-3 h-3" />
                  {label}
                </span>
              )
            })}
          </div>
        </div>

        <MasterToggle
          on={settings.enabled}
          disabled={!provider.available || save.isPending}
          color={theme.color}
          onChange={(next) => save.mutate({ enabled: next })}
        />
      </div>

      {/* Live detail strip */}
      {(status.detail || status.channel || status.inboundCount > 0 || status.outboundCount > 0) && (
        <div
          className="flex items-center gap-5 flex-wrap px-5 py-3 text-[12px]"
          style={{ background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(148,163,184,0.07)' }}
        >
          {status.channel && <Stat label="Channel" value={status.channel} />}
          {status.usersOnline !== undefined && <Stat label="On channel" value={`${status.usersOnline}`} />}
          <Stat label="Received" value={`${status.inboundCount}`} />
          <Stat label="Sent" value={`${status.outboundCount}`} />
          {status.detail && (
            <span className="flex-1 min-w-0 truncate text-right" style={{ color: stateTheme.color }}>
              {status.detail}
            </span>
          )}
        </div>
      )}

      {/* Connection form */}
      <div style={{ borderTop: '1px solid rgba(148,163,184,0.07)' }}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-[13px] font-semibold transition-colors hover:bg-white/[0.02]"
          style={{ color: '#94a3b8' }}
        >
          <span className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" /> Connection
            {!status.configured && provider.available && (
              <span className="text-[11px] font-bold" style={{ color: '#fbbf24' }}>· needs setup</span>
            )}
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="px-5 pb-5 space-y-4">
            {provider.fields.map((field) => (
              <Field
                key={field.key}
                field={field}
                value={form[field.key] ?? ''}
                allValues={form}
                secretSet={settings.secretsSet.includes(field.key) && !clearedSecrets.includes(field.key)}
                revealed={revealed.includes(field.key)}
                onReveal={() =>
                  setRevealed((r) => (r.includes(field.key) ? r.filter((k) => k !== field.key) : [...r, field.key]))
                }
                onChange={(value) => setForm((f) => ({ ...f, [field.key]: value }))}
                onClearSecret={() => {
                  setCleared((c) => [...c, field.key])
                  setForm((f) => ({ ...f, [field.key]: '' }))
                }}
              />
            ))}

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                onClick={() => save.mutate({ config: form, clearSecrets: clearedSecrets })}
                disabled={!dirty || save.isPending}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: theme.color, color: '#061018' }}
              >
                {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Save &amp; reconnect
              </button>

              <button
                onClick={() => { setTestResult(null); test.mutate() }}
                disabled={status.state !== 'online' || test.isPending}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.18)', color: '#cbd5e1' }}
              >
                {test.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send test message
              </button>

              {save.isError && (
                <span className="text-[12px]" style={{ color: '#f87171' }}>Save failed.</span>
              )}
              {testResult && (
                <span className="text-[12px]" style={{ color: testResult.ok ? '#34d399' : '#f87171' }}>
                  {testResult.message}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span style={{ color: '#5a6b80' }}>{label}</span>
      <span className="font-bold text-slate-300">{value}</span>
    </span>
  )
}

function StatusPill({ theme }: { theme: { label: string; color: string; pulse: boolean } }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-lg"
      style={{ background: `${theme.color}18`, border: `1px solid ${theme.color}44`, color: theme.color }}
    >
      <span className="relative flex w-1.5 h-1.5">
        {theme.pulse && (
          <span
            className="absolute inline-flex w-full h-full rounded-full"
            style={{ background: theme.color, animation: 'pulse-ring 1.6s ease-out infinite' }}
          />
        )}
        <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: theme.color }} />
      </span>
      {theme.label}
    </span>
  )
}

function MasterToggle({
  on, disabled, color, onChange,
}: { on: boolean; disabled: boolean; color: string; onChange: (next: boolean) => void }) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      aria-label="Enable this integration"
      className="relative flex-shrink-0 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        width: 50, height: 28,
        background: on ? color : 'rgba(148,163,184,0.18)',
        boxShadow: on ? `0 0 14px ${color}55` : 'none',
      }}
    >
      <span
        className="absolute top-1 rounded-full transition-all"
        style={{ width: 20, height: 20, left: on ? 26 : 4, background: on ? '#061018' : '#94a3b8' }}
      />
    </button>
  )
}

// ── Config fields ────────────────────────────────────────────────────────────

function Field({
  field, value, allValues, secretSet, revealed, onReveal, onChange, onClearSecret,
}: {
  field: PttConfigField
  value: string
  allValues: Record<string, string>
  secretSet: boolean
  revealed: boolean
  onReveal: () => void
  onChange: (value: string) => void
  onClearSecret: () => void
}) {
  const inputStyle = {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(148,163,184,0.16)',
    color: '#e2e8f0',
  }

  return (
    <div>
      <label className="flex items-center gap-2 text-[12px] font-bold mb-1.5" style={{ color: '#94a3b8' }}>
        {field.label}
        {field.required && <span style={{ color: '#f87171' }}>*</span>}
      </label>

      {field.type === 'list' ? (
        <ChipList value={value} placeholder={field.placeholder} onChange={onChange} />
      ) : field.optionsFrom ? (
        <ChannelPicker
          value={value}
          options={splitList(allValues[field.optionsFrom] ?? '')}
          placeholder={field.placeholder}
          onChange={onChange}
        />
      ) : field.type === 'multiline' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder={field.placeholder}
          className="w-full rounded-xl px-3 py-2.5 text-[12px] font-mono outline-none resize-y placeholder:text-slate-600"
          style={inputStyle}
        />
      ) : field.type === 'secret' ? (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={revealed ? 'text' : 'password'}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={secretSet ? '•••••••••• stored — type to replace' : field.placeholder}
              autoComplete="new-password"
              className="w-full rounded-xl px-3 py-2.5 pr-10 text-[13px] outline-none placeholder:text-slate-600"
              style={inputStyle}
            />
            <button
              type="button"
              onClick={onReveal}
              aria-label={revealed ? 'Hide' : 'Show'}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg"
              style={{ color: '#64748b' }}
            >
              {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          {secretSet && (
            <button
              type="button"
              onClick={onClearSecret}
              title="Remove the stored value"
              className="p-2.5 rounded-xl flex-shrink-0"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none placeholder:text-slate-600"
          style={inputStyle}
        />
      )}

      {field.hint && (
        <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: '#5a6b80' }}>{field.hint}</p>
      )}
    </div>
  )
}

function splitList(value: string): string[] {
  return value.split(',').map((v) => v.trim()).filter(Boolean)
}

/** Editable set of channel names, stored as a comma-separated string. */
function ChipList({
  value, placeholder, onChange,
}: { value: string; placeholder?: string; onChange: (next: string) => void }) {
  const [draft, setDraft] = useState('')
  const items = splitList(value)

  const add = () => {
    const next = draft.trim()
    // Commas are the separator, so a name containing one cannot round-trip.
    if (!next || next.includes(',') || items.includes(next)) return
    onChange([...items, next].join(', '))
    setDraft('')
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={placeholder}
          className="flex-1 rounded-xl px-3 py-2.5 text-[13px] outline-none placeholder:text-slate-600"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.16)', color: '#e2e8f0' }}
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="px-3 rounded-xl flex items-center gap-1.5 text-[12px] font-bold disabled:opacity-40"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.18)', color: '#cbd5e1' }}
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {items.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg"
              style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.28)', color: '#7dd3fc' }}
            >
              {item}
              <button
                type="button"
                onClick={() => onChange(items.filter((i) => i !== item).join(', '))}
                aria-label={`Remove ${item}`}
                style={{ color: '#64748b' }}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Pick the joined channel from the known list. Free text stays available
 * because there is no API to enumerate a consumer account's channels — the
 * list is whatever the operator typed in.
 */
function ChannelPicker({
  value, options, placeholder, onChange,
}: { value: string; options: string[]; placeholder?: string; onChange: (next: string) => void }) {
  return (
    <div className="space-y-2">
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => {
            const active = option === value
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange(option)}
                className="inline-flex items-center gap-1.5 text-[12px] font-bold px-3 py-2 rounded-xl transition-all"
                style={
                  active
                    ? { background: 'rgba(52,211,153,0.16)', border: '1px solid rgba(52,211,153,0.5)', color: '#34d399' }
                    : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.16)', color: '#94a3b8' }
                }
              >
                {active && <Check className="w-3.5 h-3.5" />}
                {option}
              </button>
            )
          })}
        </div>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none placeholder:text-slate-600"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.16)', color: '#e2e8f0' }}
      />
    </div>
  )
}

// ── Per-event routing ────────────────────────────────────────────────────────

function RoutingSection({
  events, providers, statuses,
}: {
  events: Array<{ id: string; title: string }>
  providers: PttProviderInfo[]
  statuses: PttProviderStatus[]
}) {
  return (
    <section
      className="rounded-2xl p-5"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(148,163,184,0.1)' }}
    >
      <div className="flex items-center gap-2.5 mb-1">
        <Activity className="w-4 h-4" style={{ color: '#34d399' }} />
        <h2 className="text-base font-bold text-slate-100">Forwarding per event</h2>
      </div>
      <p className="text-[13px] mb-4" style={{ color: '#7d8ea4' }}>
        Each direction is independent — a coordinator can also flip these from the field app.
      </p>

      {events.length === 0 ? (
        <div className="text-[13px] py-8 text-center rounded-xl" style={{ color: '#5a6b80', background: 'rgba(0,0,0,0.18)' }}>
          No active events. Traffic is bridged only into events that are live.
        </div>
      ) : (
        <div className="space-y-4">
          {events.map((event) => (
            <EventRoutes key={event.id} event={event} providers={providers} statuses={statuses} />
          ))}
        </div>
      )}
    </section>
  )
}

function EventRoutes({
  event, providers, statuses,
}: {
  event: { id: string; title: string }
  providers: PttProviderInfo[]
  statuses: PttProviderStatus[]
}) {
  const qc = useQueryClient()
  const routes = useQuery({ queryKey: ['ptt', 'routes', event.id], queryFn: () => fetchPttRoutes(event.id) })

  const mutate = useMutation({
    mutationFn: ({ kind, patch }: { kind: PttChannelKind; patch: { inbound?: boolean; outbound?: boolean } }) =>
      updatePttRoute(event.id, kind, patch),
    onSuccess: (next) => qc.setQueryData(['ptt', 'routes', event.id], next),
  })

  const routeFor = (kind: PttChannelKind): PttRoute =>
    routes.data?.routes.find((r) => r.kind === kind) ?? { kind, inbound: true, outbound: true }

  return (
    <div className="rounded-2xl p-4" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(148,163,184,0.08)' }}>
      <div className="text-[13px] font-bold text-slate-200 mb-3 truncate">{event.title}</div>
      <div className="grid gap-3 md:grid-cols-2">
        {providers.map((provider) => {
          const status = statuses.find((s) => s.kind === provider.kind)
          const route = routeFor(provider.kind)
          return (
            <BridgeFlow
              key={provider.kind}
              kind={provider.kind}
              inbound={route.inbound}
              outbound={route.outbound}
              live={status?.state === 'online'}
              disabled={!provider.available || mutate.isPending}
              disabledReason={!provider.available ? 'Not available yet' : undefined}
              onToggle={(direction, next) => mutate.mutate({ kind: provider.kind, patch: { [direction]: next } })}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── Activity ─────────────────────────────────────────────────────────────────

function ActivityLog({ entries }: { entries: Array<{ at: string; kind: string; level: string; message: string }> }) {
  const [open, setOpen] = useState(false)
  const shown = open ? entries.slice(0, 60) : entries.slice(0, 6)

  return (
    <section
      className="rounded-2xl p-5"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(148,163,184,0.1)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <RefreshCw className="w-4 h-4" style={{ color: '#38bdf8' }} />
          <h2 className="text-base font-bold text-slate-100">Bridge activity</h2>
        </div>
        {entries.length > 6 && (
          <button onClick={() => setOpen((o) => !o)} className="text-[12px] font-bold" style={{ color: '#38bdf8' }}>
            {open ? 'Show less' : `Show all (${entries.length})`}
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="text-[13px] py-6 text-center" style={{ color: '#5a6b80' }}>Nothing yet.</div>
      ) : (
        <div className="space-y-1 font-mono text-[11.5px]">
          {shown.map((entry, i) => (
            <div key={`${entry.at}-${i}`} className="flex gap-2.5 items-baseline py-1" style={{ borderBottom: '1px solid rgba(148,163,184,0.05)' }}>
              <span style={{ color: '#475569' }}>{new Date(entry.at).toLocaleTimeString()}</span>
              <span className="font-bold uppercase" style={{ color: CHANNEL_THEME[entry.kind as PttChannelKind]?.color ?? '#64748b' }}>
                {entry.kind}
              </span>
              <span
                className="flex-1 min-w-0 break-words"
                style={{ color: entry.level === 'error' ? '#f87171' : entry.level === 'warn' ? '#fbbf24' : '#94a3b8' }}
              >
                {entry.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="rounded-2xl p-6 flex items-center gap-4"
      style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}
    >
      <AlertTriangle className="w-6 h-6 flex-shrink-0" style={{ color: '#f87171' }} />
      <div className="flex-1">
        <div className="text-sm font-bold" style={{ color: '#fecaca' }}>Could not load the integration settings</div>
        <div className="text-[12px] mt-0.5" style={{ color: '#f87171' }}>The API may be unreachable, or your session is not a coordinator.</div>
      </div>
      <button
        onClick={onRetry}
        className="px-4 py-2 rounded-xl text-[13px] font-bold"
        style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', color: '#fecaca' }}
      >
        Retry
      </button>
    </div>
  )
}
