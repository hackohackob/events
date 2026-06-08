import { useEffect, useRef, useState } from 'react'
import {
  X, Gauge, Crosshair, Pause, Play, WifiOff, Wifi, Navigation, Flag,
  Route as RouteIcon, AlertTriangle, MessageSquare, Trash2, RefreshCw, Send, MapPin, Activity, Radio,
} from 'lucide-react'
import type { SimEntity, MedicStatus, RouteMode } from './simulation'
import type { SimIncident, Track } from './api'

export type MapMode = null | { kind: 'sendHere' | 'addWaypoint' | 'report'; id: string }

interface Props {
  medic: SimEntity
  incidents: SimIncident[]
  tracks: Track[]
  mapMode: MapMode
  onClose: () => void
  onPatch: (patch: Partial<SimEntity>) => void
  onStatus: (status: MedicStatus) => void
  onSetMapMode: (m: MapMode) => void
  onSendToIncident: (incident: SimIncident) => void
  onFollowTrack: (trackId: string, mode: RouteMode, dir: 1 | -1) => void
  onClearRoute: () => void
  onReportNow: (details: { type?: string; severity?: string; description?: string }) => void
  onChat: (text: string) => void
  onRefreshIncidents: () => void
  onRemove: () => void
}

const STATUS_META: Record<MedicStatus, { label: string; color: string }> = {
  available: { label: 'Available', color: '#22c55e' },
  rest: { label: 'Rest', color: '#a78bfa' },
  going_to: { label: 'Going to', color: '#f59e0b' },
}

const SPEED_PRESETS = [
  { label: 'Walk', value: 1.4 },
  { label: 'Jog', value: 3 },
  { label: 'Bike', value: 6 },
  { label: 'Ambulance', value: 14 },
]
const ACCURACY_PRESETS = [5, 15, 50, 150, 300]
const INCIDENT_TYPES = ['medical', 'cardiac', 'trauma', 'fracture', 'unconscious', 'other']
const SEVERITIES: Array<{ id: string; color: string }> = [
  { id: 'low', color: '#22c55e' }, { id: 'medium', color: '#eab308' },
  { id: 'high', color: '#f97316' }, { id: 'critical', color: '#ef4444' },
]

export function MedicControlPanel(props: Props) {
  const { medic, incidents, tracks, mapMode, onClose, onPatch, onStatus, onSetMapMode } = props
  const accent = medic.color
  const initials = medic.name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')

  const [trackId, setTrackId] = useState(tracks[0]?.id ?? '')
  const [routeMode, setRouteMode] = useState<RouteMode>('loop')
  const [routeDir, setRouteDir] = useState<1 | -1>(1)
  const [reportOpen, setReportOpen] = useState(false)
  const [repType, setRepType] = useState('medical')
  const [repSev, setRepSev] = useState('high')
  const [repNote, setRepNote] = useState('')
  const [chat, setChat] = useState('')

  useEffect(() => { if (!trackId && tracks[0]) setTrackId(tracks[0].id) }, [tracks, trackId])

  const st = STATUS_META[medic.status ?? 'available']
  const waypointCount = medic.routePoints?.length ?? 0

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 12px', borderBottom: '1px solid rgba(148,163,184,0.1)' }}>
        <div style={{
          width: 42, height: 42, borderRadius: '50%', background: accent, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff',
          boxShadow: `0 0 0 3px ${accent}44`,
        }}>{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#e8eef7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{medic.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, color: st.color, background: `${st.color}1e` }}>{st.label}</span>
            {medic.offline && <Tag color="#64748b" icon={<WifiOff size={9} />}>offline</Tag>}
            {medic.paused && <Tag color="#f59e0b" icon={<Pause size={9} />}>frozen</Tag>}
            <Tag color="#60a5fa" icon={<Radio size={9} />}>{(medic.sendChannel ?? 'ws').toUpperCase()}</Tag>
          </div>
        </div>
        <button onClick={onClose} style={iconBtn}><X size={16} color="#94a3b8" /></button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Quick toggles */}
        <div style={{ display: 'flex', gap: 8 }}>
          <QuickToggle active={!!medic.paused} onClick={() => onPatch({ paused: !medic.paused })}
            icon={medic.paused ? <Play size={14} /> : <Pause size={14} />} label={medic.paused ? 'Resume' : 'Freeze'} color="#f59e0b" />
          <QuickToggle active={!!medic.offline} onClick={() => onPatch({ offline: !medic.offline })}
            icon={medic.offline ? <Wifi size={14} /> : <WifiOff size={14} />} label={medic.offline ? 'Go online' : 'Go offline'} color="#64748b" />
        </div>

        {/* Channel */}
        <Section title="Send channel" icon={<Radio size={12} />}>
          <Segmented options={[{ id: 'ws', label: 'WebSocket' }, { id: 'http', label: 'HTTP' }]}
            value={medic.sendChannel ?? 'ws'} onChange={v => onPatch({ sendChannel: v as 'ws' | 'http' })} accent={accent} />
        </Section>

        {/* Status */}
        <Section title="Status" icon={<Activity size={12} />}>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['available', 'rest', 'going_to'] as MedicStatus[]).map(s => (
              <button key={s} onClick={() => onStatus(s)} style={{
                flex: 1, padding: '8px 0', borderRadius: 9, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                border: `1px solid ${medic.status === s ? STATUS_META[s].color : 'rgba(148,163,184,0.16)'}`,
                background: medic.status === s ? `${STATUS_META[s].color}22` : 'rgba(255,255,255,0.03)',
                color: medic.status === s ? STATUS_META[s].color : '#94a3b8',
              }}>{STATUS_META[s].label}</button>
            ))}
          </div>
        </Section>

        {/* Speed */}
        <Section title={`Speed — ${medic.speed.toFixed(1)} m/s`} icon={<Gauge size={12} />}>
          <Slider min={0} max={20} step={0.1} value={medic.speed} onChange={v => onPatch({ speed: v })} accent={accent} />
          <Chips options={SPEED_PRESETS.map(p => ({ id: String(p.value), label: p.label }))}
            value={String(medic.speed)} onChange={v => onPatch({ speed: Number(v) })} accent={accent} />
        </Section>

        {/* Accuracy + jitter */}
        <Section title={`GPS accuracy — ±${Math.round(medic.accuracy ?? 5)} m`} icon={<Crosshair size={12} />}>
          <Slider min={3} max={500} step={1} value={medic.accuracy ?? 5} onChange={v => onPatch({ accuracy: Math.round(v) })} accent={accent} />
          <Chips options={ACCURACY_PRESETS.map(a => ({ id: String(a), label: `${a}m` }))}
            value={String(Math.round(medic.accuracy ?? 5))} onChange={v => onPatch({ accuracy: Number(v) })} accent={accent} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>GPS drift {medic.jitterM ? `±${medic.jitterM}m` : 'off'}</span>
            <Switch on={!!medic.jitterM} onClick={() => onPatch({ jitterM: medic.jitterM ? 0 : 12 })} accent={accent} />
          </div>
          {!!medic.jitterM && (
            <Slider min={2} max={60} step={1} value={medic.jitterM} onChange={v => onPatch({ jitterM: Math.round(v) })} accent={accent} />
          )}
        </Section>

        {/* Movement */}
        <Section title="Movement" icon={<Navigation size={12} />}>
          {medic.routeLabel && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 10px', borderRadius: 9, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#fbbf24', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <Flag size={10} style={{ display: 'inline', marginRight: 5 }} />{medic.routeLabel}{waypointCount > 2 ? ` · ${waypointCount} pts` : ''}
              </span>
              <button onClick={props.onClearRoute} style={{ ...iconBtnSmall, color: '#fbbf24' }}><X size={13} /></button>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <ModeBtn active={mapMode?.kind === 'sendHere'} onClick={() => onSetMapMode(mapMode?.kind === 'sendHere' ? null : { kind: 'sendHere', id: medic.id })}
              icon={<MapPin size={13} />} label="Send here" accent={accent} />
            <ModeBtn active={mapMode?.kind === 'addWaypoint'} onClick={() => onSetMapMode(mapMode?.kind === 'addWaypoint' ? null : { kind: 'addWaypoint', id: medic.id })}
              icon={<RouteIcon size={13} />} label="Add waypoints" accent={accent} />
          </div>
          {mapMode && mapMode.id === medic.id && (
            <div style={{ fontSize: 10.5, color: '#fbbf24', marginTop: 7, textAlign: 'center' }}>
              {mapMode.kind === 'addWaypoint' ? 'Click the map to queue waypoints. Click “Add waypoints” again to finish.' : 'Click the map to set destination.'}
            </div>
          )}

          {/* Follow a track */}
          {tracks.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <select value={trackId} onChange={e => setTrackId(e.target.value)} style={selectStyle}>
                {tracks.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 6 }}>
                <Segmented small options={[{ id: 'loop', label: 'Loop' }, { id: 'pingpong', label: 'Ping-pong' }, { id: 'once', label: 'Once' }]}
                  value={routeMode} onChange={v => setRouteMode(v as RouteMode)} accent={accent} />
                <button onClick={() => setRouteDir(d => (d * -1) as 1 | -1)} title="Reverse direction" style={{ ...iconBtnSmall, width: 32, flexShrink: 0, border: '1px solid rgba(148,163,184,0.16)', borderRadius: 8 }}>
                  <span style={{ fontSize: 13, color: '#94a3b8' }}>{routeDir > 0 ? '→' : '←'}</span>
                </button>
              </div>
              <button onClick={() => trackId && props.onFollowTrack(trackId, routeMode, routeDir)} style={primaryBtn(accent)}>
                <RouteIcon size={13} /> Follow track
              </button>
            </div>
          )}
        </Section>

        {/* Incident */}
        <Section title="Incident" icon={<AlertTriangle size={12} />}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <ModeBtn active={reportOpen} onClick={() => setReportOpen(o => !o)} icon={<AlertTriangle size={13} />} label="Report" accent="#ef4444" />
            <ModeBtn active={mapMode?.kind === 'report'} onClick={() => onSetMapMode(mapMode?.kind === 'report' ? null : { kind: 'report', id: medic.id })}
              icon={<MapPin size={13} />} label="Report on map" accent="#ef4444" />
          </div>
          {reportOpen && (
            <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Chips options={INCIDENT_TYPES.map(t => ({ id: t, label: t }))} value={repType} onChange={setRepType} accent="#ef4444" wrap />
              <div style={{ display: 'flex', gap: 6 }}>
                {SEVERITIES.map(s => (
                  <button key={s.id} onClick={() => setRepSev(s.id)} style={{
                    flex: 1, padding: '6px 0', borderRadius: 8, cursor: 'pointer', fontSize: 10.5, fontWeight: 700, textTransform: 'capitalize',
                    border: `1px solid ${repSev === s.id ? s.color : 'rgba(148,163,184,0.16)'}`,
                    background: repSev === s.id ? `${s.color}22` : 'rgba(255,255,255,0.03)', color: repSev === s.id ? s.color : '#94a3b8',
                  }}>{s.id}</button>
                ))}
              </div>
              <input value={repNote} onChange={e => setRepNote(e.target.value)} placeholder="Note (optional)…" style={inputStyle} />
              <button onClick={() => { props.onReportNow({ type: repType, severity: repSev, description: repNote || undefined }); setReportOpen(false); setRepNote('') }} style={primaryBtn('#ef4444')}>
                <AlertTriangle size={13} /> Report at current location
              </button>
            </div>
          )}

          {/* Send to incident */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Dispatch to incident</span>
            <button onClick={props.onRefreshIncidents} style={iconBtnSmall}><RefreshCw size={12} color="#64748b" /></button>
          </div>
          {incidents.length === 0 ? (
            <div style={{ fontSize: 11, color: '#475569', padding: '6px 0' }}>No open incidents. Refresh or report one.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 150, overflowY: 'auto' }}>
              {incidents.map(inc => {
                const active = medic.assignedIncidentId === inc.id
                return (
                  <button key={inc.id} onClick={() => props.onSendToIncident(inc)} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, cursor: 'pointer', textAlign: 'left',
                    border: `1px solid ${active ? '#f59e0b66' : 'rgba(148,163,184,0.1)'}`, background: active ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.03)',
                  }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inc.name ?? inc.type}</div>
                      <div style={{ fontSize: 9.5, color: '#475569' }}>{inc.type} · {inc.status}</div>
                    </div>
                    <Navigation size={13} color={active ? '#f59e0b' : '#475569'} />
                  </button>
                )
              })}
            </div>
          )}

          {/* Chat — only when responding */}
          {medic.assignedIncidentId && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                <MessageSquare size={11} style={{ display: 'inline', marginRight: 5 }} />Incident chat
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={chat} onChange={e => setChat(e.target.value)} placeholder="Message the team…" style={{ ...inputStyle, flex: 1 }}
                  onKeyDown={e => { if (e.key === 'Enter' && chat.trim()) { props.onChat(chat); setChat('') } }} />
                <button onClick={() => { if (chat.trim()) { props.onChat(chat); setChat('') } }} style={{ ...primaryBtn(accent), width: 40, padding: 0 }}><Send size={14} /></button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                {['On scene', 'Need backup', 'Patient stable', 'Transporting'].map(q => (
                  <button key={q} onClick={() => props.onChat(q)} style={quickChip}>{q}</button>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* Remove */}
        <button onClick={props.onRemove} style={{ ...primaryBtn('#ef4444'), background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
          <Trash2 size={13} /> Remove medic
        </button>
      </div>
    </div>
  )
}

// ─── Styled primitives ─────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  position: 'absolute', top: 16, right: 16, bottom: 16, width: 348, zIndex: 60,
  display: 'flex', flexDirection: 'column',
  background: 'rgba(7,16,32,0.96)', backdropFilter: 'blur(16px)',
  border: '1px solid rgba(148,163,184,0.16)', borderRadius: 18,
  boxShadow: '0 24px 70px rgba(0,0,0,0.6)', overflow: 'hidden',
}
const iconBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 9, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const iconBtnSmall: React.CSSProperties = { width: 24, height: 24, borderRadius: 7, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const selectStyle: React.CSSProperties = { width: '100%', height: 32, borderRadius: 8, padding: '0 8px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(148,163,184,0.15)', color: '#e2e8f0', fontSize: 11, fontWeight: 600, outline: 'none', cursor: 'pointer' }
const inputStyle: React.CSSProperties = { height: 34, borderRadius: 9, padding: '0 11px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(148,163,184,0.15)', color: '#e2e8f0', fontSize: 12, outline: 'none' }
const quickChip: React.CSSProperties = { padding: '4px 9px', borderRadius: 999, fontSize: 10, fontWeight: 600, cursor: 'pointer', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)', color: '#94a3b8' }

function primaryBtn(color: string): React.CSSProperties {
  return { height: 36, borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 12, fontWeight: 700, background: `${color}1c`, color, border: `1px solid ${color}3a` }
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9, color: '#64748b' }}>
        {icon}
        <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Tag({ color, icon, children }: { color: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 999, color, background: `${color}1e` }}>{icon}{children}</span>
}

function QuickToggle({ active, onClick, icon, label, color }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; color: string }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, height: 38, borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 12, fontWeight: 700,
      border: `1px solid ${active ? color : 'rgba(148,163,184,0.16)'}`, background: active ? `${color}22` : 'rgba(255,255,255,0.03)', color: active ? color : '#94a3b8',
    }}>{icon}{label}</button>
  )
}

function ModeBtn({ active, onClick, icon, label, accent }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; accent: string }) {
  return (
    <button onClick={onClick} style={{
      height: 36, borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11.5, fontWeight: 700,
      border: `1px solid ${active ? accent : 'rgba(148,163,184,0.16)'}`, background: active ? `${accent}22` : 'rgba(255,255,255,0.03)', color: active ? accent : '#94a3b8',
    }}>{icon}{label}</button>
  )
}

function Segmented({ options, value, onChange, accent, small }: { options: Array<{ id: string; label: string }>; value: string; onChange: (v: string) => void; accent: string; small?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 10, background: 'rgba(255,255,255,0.04)', flex: 1 }}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{
          flex: 1, padding: small ? '5px 0' : '7px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: small ? 10 : 11, fontWeight: 700,
          background: value === o.id ? `${accent}28` : 'transparent', color: value === o.id ? accent : '#64748b',
        }}>{o.label}</button>
      ))}
    </div>
  )
}

function Chips({ options, value, onChange, accent, wrap }: { options: Array<{ id: string; label: string }>; value: string; onChange: (v: string) => void; accent: string; wrap?: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: wrap ? 'wrap' : 'nowrap', gap: 6, marginTop: 8 }}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{
          flex: wrap ? '0 0 auto' : 1, padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 10.5, fontWeight: 700, textTransform: 'capitalize',
          border: `1px solid ${value === o.id ? accent : 'rgba(148,163,184,0.14)'}`, background: value === o.id ? `${accent}20` : 'rgba(255,255,255,0.03)', color: value === o.id ? accent : '#94a3b8',
        }}>{o.label}</button>
      ))}
    </div>
  )
}

function Slider({ min, max, step, value, onChange, accent }: { min: number; max: number; step: number; value: number; onChange: (v: number) => void; accent: string }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}
      style={{ width: '100%', height: 6, borderRadius: 3, appearance: 'none', cursor: 'pointer', outline: 'none',
        background: `linear-gradient(90deg, ${accent} ${pct}%, rgba(148,163,184,0.18) ${pct}%)` }} />
  )
}

function Switch({ on, onClick, accent }: { on: boolean; onClick: () => void; accent: string }) {
  return (
    <button onClick={onClick} style={{ width: 38, height: 22, borderRadius: 999, border: 'none', cursor: 'pointer', padding: 2, background: on ? accent : 'rgba(148,163,184,0.2)', transition: 'background 0.2s', position: 'relative' }}>
      <span style={{ display: 'block', width: 18, height: 18, borderRadius: '50%', background: '#fff', transform: on ? 'translateX(16px)' : 'translateX(0)', transition: 'transform 0.2s' }} />
    </button>
  )
}