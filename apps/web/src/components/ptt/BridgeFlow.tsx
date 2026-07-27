'use client'

import { ArrowLeft, ArrowRight, Radio, Smartphone } from 'lucide-react'
import type { PttChannelKind } from '@events/contracts'

/**
 * The bidirectional bridge control: two nodes with a lane per direction.
 *
 * Each lane is its own button, because the two directions are genuinely
 * independent — "listen to the radio without putting our chatter on the air" is
 * the common case. An enabled lane marches toward its destination so the
 * direction is readable at a glance rather than from the label alone.
 */

export const CHANNEL_THEME: Record<PttChannelKind, { color: string; glow: string; label: string; short: string }> = {
  zello: { color: '#f59e0b', glow: 'rgba(245,158,11,0.45)', label: 'Zello', short: 'ZLO' },
  radio: { color: '#38bdf8', glow: 'rgba(56,189,248,0.45)', label: 'Digital radio', short: 'DMR' },
}

interface Props {
  kind: PttChannelKind
  inbound: boolean
  outbound: boolean
  /** True while the provider actually holds a live connection. */
  live?: boolean
  disabled?: boolean
  disabledReason?: string
  onToggle: (direction: 'inbound' | 'outbound', next: boolean) => void
  compact?: boolean
}

export default function BridgeFlow({
  kind,
  inbound,
  outbound,
  live = false,
  disabled = false,
  disabledReason,
  onToggle,
  compact = false,
}: Props) {
  const theme = CHANNEL_THEME[kind]

  return (
    <div
      className="rounded-2xl px-4 py-4"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(148,163,184,0.1)',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div className="flex items-center gap-3">
        <Node icon={<Smartphone className="w-4 h-4" />} label="App" sub="Team chat" color="#34d399" live={live} compact={compact} />

        <div className="flex-1 min-w-0 flex flex-col gap-2.5 py-1">
          <Lane
            direction="outbound"
            label="App → "
            channel={theme.label}
            enabled={outbound && !disabled}
            live={live}
            color={theme.color}
            disabled={disabled}
            onClick={() => !disabled && onToggle('outbound', !outbound)}
          />
          <Lane
            direction="inbound"
            label=" → App"
            channel={theme.label}
            enabled={inbound && !disabled}
            live={live}
            color={theme.color}
            disabled={disabled}
            onClick={() => !disabled && onToggle('inbound', !inbound)}
          />
        </div>

        <Node
          icon={<Radio className="w-4 h-4" />}
          label={theme.label}
          sub={live ? 'Connected' : 'Offline'}
          color={theme.color}
          live={live}
          compact={compact}
        />
      </div>

      {disabled && disabledReason && (
        <div className="text-[11px] mt-3 text-center" style={{ color: '#64748b' }}>
          {disabledReason}
        </div>
      )}
    </div>
  )
}

function Node({
  icon,
  label,
  sub,
  color,
  live,
  compact,
}: {
  icon: React.ReactNode
  label: string
  sub: string
  color: string
  live: boolean
  compact: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 flex-shrink-0" style={{ width: compact ? 62 : 74 }}>
      <div
        className={`rounded-2xl flex items-center justify-center ${live ? 'ptt-node-live' : ''}`}
        style={{
          width: compact ? 38 : 44,
          height: compact ? 38 : 44,
          color,
          background: `${color}1a`,
          border: `1px solid ${color}55`,
          ['--flow-glow' as string]: `${color}55`,
        }}
      >
        {icon}
      </div>
      <div className="text-center leading-tight">
        <div className="text-[11px] font-bold text-slate-300 truncate">{label}</div>
        {!compact && <div className="text-[9.5px]" style={{ color: '#64748b' }}>{sub}</div>}
      </div>
    </div>
  )
}

function Lane({
  direction,
  label,
  channel,
  enabled,
  live,
  color,
  disabled,
  onClick,
}: {
  direction: 'inbound' | 'outbound'
  label: string
  channel: string
  enabled: boolean
  live: boolean
  color: string
  disabled: boolean
  onClick: () => void
}) {
  const reverse = direction === 'inbound'
  const Arrow = reverse ? ArrowLeft : ArrowRight
  const title = reverse ? `${channel} → App` : `App → ${channel}`

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`${title} — click to turn ${enabled ? 'off' : 'on'}`}
      aria-pressed={enabled}
      aria-label={title}
      className="group w-full flex items-center gap-2 rounded-lg px-1 py-1 transition-colors disabled:cursor-not-allowed"
      style={{ background: 'transparent' }}
    >
      {reverse && <Arrow className="w-3.5 h-3.5 flex-shrink-0 transition-colors" style={{ color: enabled ? color : '#475569' }} />}
      <span className="flex-1 min-w-0 flex flex-col gap-1">
        <span
          className="text-[9.5px] font-bold uppercase tracking-wider text-left"
          style={{ color: enabled ? color : '#475569', textAlign: reverse ? 'right' : 'left' }}
        >
          {reverse ? `${channel}${label}` : `${label}${channel}`}
        </span>
        <span
          className={`ptt-lane ${enabled ? 'ptt-lane-on' : 'ptt-lane-off'} ${reverse ? 'ptt-lane-reverse' : ''}`}
          style={{ ['--flow-color' as string]: color }}
        >
          {/* The travelling packet only shows when traffic could actually move. */}
          {enabled && live && <span className="ptt-packet" />}
        </span>
      </span>
      {!reverse && <Arrow className="w-3.5 h-3.5 flex-shrink-0 transition-colors" style={{ color: enabled ? color : '#475569' }} />}
    </button>
  )
}
