'use client'

import { useMemo, useState } from 'react'
import { Area, AreaChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChevronDown, Eye, EyeOff, Mountain } from 'lucide-react'
import { POI_CONFIGS } from '@/lib/constants'

export interface PanelTrack {
  id: string
  name: string
  color: string
  coordinates: [number, number][]
  /** distance km → elevation m; empty when the GPX carried no elevation. */
  elevationProfile: { distance: number; elevation: number }[]
}

export interface PanelPoi {
  /** `[lng, lat]` */
  coordinates: [number, number]
  type: string
  name?: string
}

interface Props {
  tracks: PanelTrack[]
  /** Ids currently drawn on the map. */
  visibleIds: string[]
  onToggleVisible: (trackId: string) => void
  /** Points of interest, projected onto whichever track's profile is open. */
  pois: PanelPoi[]
}

/** Metres between two `[lng, lat]` points (equirectangular — fine at these scales). */
function metersBetween(a: [number, number], b: [number, number]): number {
  const R = 6_371_000
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const mLat = (((a[1] + b[1]) / 2) * Math.PI) / 180
  const x = dLng * Math.cos(mLat)
  return Math.sqrt(x * x + dLat * dLat) * R
}

/**
 * A POI is "on" the track only if it sits within this distance of it — a start
 * car park 3 km away has no meaningful place on the profile.
 */
const POI_SNAP_MAX_M = 400

/**
 * Project each POI onto the track and return where it lands on the elevation
 * profile: nearest track vertex → cumulative distance → elevation at that
 * distance. POIs further than {@link POI_SNAP_MAX_M} from the track are dropped.
 */
function projectPois(track: PanelTrack, pois: PanelPoi[]) {
  if (track.coordinates.length < 2 || track.elevationProfile.length < 2) return []

  // Cumulative distance (km) per track vertex.
  const cum: number[] = [0]
  for (let i = 1; i < track.coordinates.length; i++) {
    cum[i] = cum[i - 1] + metersBetween(track.coordinates[i - 1], track.coordinates[i]) / 1000
  }

  const elevationAt = (km: number): number => {
    const p = track.elevationProfile
    if (km <= p[0].distance) return p[0].elevation
    if (km >= p[p.length - 1].distance) return p[p.length - 1].elevation
    for (let i = 1; i < p.length; i++) {
      if (p[i].distance >= km) {
        const span = p[i].distance - p[i - 1].distance
        const t = span > 0 ? (km - p[i - 1].distance) / span : 0
        return p[i - 1].elevation + t * (p[i].elevation - p[i - 1].elevation)
      }
    }
    return p[p.length - 1].elevation
  }

  return pois
    .map(poi => {
      let bestIdx = 0
      let bestDist = Infinity
      for (let i = 0; i < track.coordinates.length; i++) {
        const d = metersBetween(track.coordinates[i], poi.coordinates)
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      }
      if (bestDist > POI_SNAP_MAX_M) return null
      const km = cum[bestIdx]
      return {
        km,
        elevation: elevationAt(km),
        color: POI_CONFIGS.find(c => c.type === poi.type)?.color ?? '#94a3b8',
        label: poi.name || POI_CONFIGS.find(c => c.type === poi.type)?.label || 'Point',
      }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
}

/** Total ascent (m) of a profile — the number riders actually care about. */
function totalAscent(profile: { elevation: number }[]): number {
  let gain = 0
  for (let i = 1; i < profile.length; i++) {
    const d = profile[i].elevation - profile[i - 1].elevation
    if (d > 0) gain += d
  }
  return Math.round(gain)
}

/**
 * Tracks section, embedded as a collapsible block inside the Layers panel —
 * same shape as ZonesPanel. Each track can be shown/hidden individually and
 * can pop open the same elevation profile the event editor shows, with the
 * event's points of interest marked along it.
 */
export default function TracksPanel({ tracks, visibleIds, onToggleVisible, pois }: Props) {
  const [open, setOpen] = useState(false)
  const [profileId, setProfileId] = useState<string | null>(null)

  const profileTrack = tracks.find(t => t.id === profileId) ?? null
  const profilePois = useMemo(
    () => (profileTrack ? projectPois(profileTrack, pois) : []),
    [profileTrack, pois],
  )

  return (
    <div className="flex flex-col gap-1.5" style={{ borderTop: '1px solid rgba(148,163,184,0.1)', marginTop: 8, paddingTop: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full"
        style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#334155' }}>
          Tracks
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold" style={{ color: '#475569' }}>
            {visibleIds.length}/{tracks.length}
          </span>
          <ChevronDown
            className="w-3.5 h-3.5 transition-transform"
            style={{ color: '#64748b', transform: open ? 'rotate(180deg)' : 'none' }}
          />
        </span>
      </button>

      {open && (
        <>
          {tracks.length === 0 && (
            <div className="text-[11px] px-1" style={{ color: '#475569' }}>No tracks on this event.</div>
          )}

          {tracks.map(track => {
            const visible = visibleIds.includes(track.id)
            const hasProfile = track.elevationProfile.length > 1
            const profileOpen = profileId === track.id
            return (
              <div
                key={track.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                style={{
                  background: visible ? `${track.color}14` : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${visible ? track.color + '40' : 'rgba(148,163,184,0.08)'}`,
                }}
              >
                <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: track.color }} />
                <span className="flex-1 text-xs font-medium truncate" style={{ color: visible ? '#e2e8f0' : '#64748b' }}>
                  {track.name}
                </span>
                <button
                  onClick={() => hasProfile && setProfileId(profileOpen ? null : track.id)}
                  disabled={!hasProfile}
                  title={hasProfile ? 'Elevation profile' : 'This track has no elevation data'}
                  style={{ color: profileOpen ? '#f97316' : hasProfile ? '#64748b' : '#334155', cursor: hasProfile ? 'pointer' : 'default' }}
                >
                  <Mountain className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onToggleVisible(track.id)}
                  title={visible ? 'Hide track' : 'Show track'}
                  style={{ color: visible ? '#22c55e' : '#475569' }}
                >
                  {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              </div>
            )
          })}

          {profileTrack && profileTrack.elevationProfile.length > 1 && (
            <div
              className="rounded-lg p-2"
              style={{ background: 'rgba(2,8,20,0.6)', border: '1px solid rgba(148,163,184,0.12)' }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold truncate" style={{ color: '#cbd5e1' }}>
                  {profileTrack.name}
                </span>
                <span className="text-[10px]" style={{ color: '#64748b' }}>
                  {totalAscent(profileTrack.elevationProfile).toLocaleString()} m+ ·{' '}
                  {profileTrack.elevationProfile[profileTrack.elevationProfile.length - 1].distance.toFixed(1)} km
                </span>
              </div>
              <div style={{ height: 110 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={profileTrack.elevationProfile} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id={`trkElev-${profileTrack.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={profileTrack.color} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={profileTrack.color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="distance" type="number" domain={['dataMin', 'dataMax']} hide />
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(10,20,36,0.95)',
                        border: '1px solid rgba(148,163,184,0.15)',
                        borderRadius: '10px',
                        fontSize: '11px',
                        color: '#f1f5f9',
                      }}
                      formatter={(v: number) => [`${v} m`, 'Elevation']}
                      labelFormatter={(l: number) => `${Number(l).toFixed(1)} km`}
                    />
                    <Area
                      type="linear"
                      dataKey="elevation"
                      stroke={profileTrack.color}
                      strokeWidth={1.5}
                      fill={`url(#trkElev-${profileTrack.id})`}
                      dot={false}
                      isAnimationActive={false}
                      activeDot={{ r: 3.5, fill: profileTrack.color, stroke: 'white', strokeWidth: 1.5 }}
                    />
                    {/* Points of interest, snapped onto the profile. */}
                    {profilePois.map((p, i) => (
                      <ReferenceDot
                        key={`${p.label}-${i}`}
                        x={p.km}
                        y={p.elevation}
                        r={3.5}
                        fill={p.color}
                        stroke="#04121f"
                        strokeWidth={1}
                        isFront
                        label={{ value: p.label, position: 'top', fontSize: 8, fill: p.color }}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {profilePois.length === 0 && (
                <div className="text-[10px] mt-1" style={{ color: '#475569' }}>No points of interest along this track.</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
