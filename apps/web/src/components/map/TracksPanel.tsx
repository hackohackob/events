'use client'

import { useMemo, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChevronDown, Eye, EyeOff, Mountain, Siren, X } from 'lucide-react'
import { POI_CONFIGS } from '@/lib/constants'
import { PoiIcon } from '@/lib/poi-icons'

export interface PanelTrack {
  id: string
  name: string
  color: string
  coordinates: [number, number][]
  /** distance km → elevation m; empty when the GPX carried no elevation. */
  elevationProfile: { distance: number; elevation: number }[]
  /** The event's own figures — preferred over re-deriving them from the profile. */
  distanceKm?: number
  ascentMeters?: number
}

export interface PanelPoi {
  /** `[lng, lat]` */
  coordinates: [number, number]
  type: string
  name?: string
  /** Per-point custom glyph key (custom POIs only). */
  icon?: string | null
}

export interface PanelIncident {
  /** `[lng, lat]` */
  coordinates: [number, number]
  type?: string
  name?: string
}

interface Props {
  tracks: PanelTrack[]
  /** Ids currently drawn on the map. */
  visibleIds: string[]
  onToggleVisible: (trackId: string) => void
  /** Track whose elevation profile is open over the map, if any. */
  profileTrackId: string | null
  onToggleProfile: (trackId: string) => void
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

/** One POI or incident, placed on the profile. */
interface ProfileMark {
  kind: 'poi' | 'incident'
  km: number
  elevation: number
  color: string
  label: string
  /** POI type / custom glyph, used to pick the icon. */
  type?: string
  icon?: string | null
}

/**
 * Project each POI and incident onto the track and return where it lands on the
 * elevation profile: nearest track vertex → cumulative distance → elevation at
 * that distance. Points further than {@link POI_SNAP_MAX_M} from the track are
 * dropped — they have no meaningful place on it.
 */
function projectMarks(track: PanelTrack, pois: PanelPoi[], incidents: PanelIncident[]): ProfileMark[] {
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

  /** Nearest track vertex, or null when the point is nowhere near the line. */
  const snap = (coordinates: [number, number]): number | null => {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < track.coordinates.length; i++) {
      const d = metersBetween(track.coordinates[i], coordinates)
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    return bestDist > POI_SNAP_MAX_M ? null : bestIdx
  }

  const marks: ProfileMark[] = []

  for (const poi of pois) {
    const idx = snap(poi.coordinates)
    if (idx === null) continue
    const config = POI_CONFIGS.find(c => c.type === poi.type)
    marks.push({
      kind: 'poi',
      km: cum[idx],
      elevation: elevationAt(cum[idx]),
      color: config?.color ?? '#94a3b8',
      label: poi.name || config?.label || 'Point',
      type: poi.type,
      icon: poi.icon,
    })
  }

  for (const incident of incidents) {
    const idx = snap(incident.coordinates)
    if (idx === null) continue
    marks.push({
      kind: 'incident',
      km: cum[idx],
      elevation: elevationAt(cum[idx]),
      color: '#ef4444',
      label: incident.name || incident.type || 'Incident',
    })
  }

  // Incidents last so they sit above the POIs where the two collide.
  return marks.sort((a, b) => (a.kind === b.kind ? a.km - b.km : a.kind === 'incident' ? 1 : -1))
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
 * same shape as ZonesPanel. Each track can be shown/hidden individually, and
 * the mountain button opens its elevation profile as a strip over the map (see
 * {@link TrackElevationOverlay}) rather than inside this cramped popup.
 */
export default function TracksPanel({
  tracks,
  visibleIds,
  onToggleVisible,
  profileTrackId,
  onToggleProfile,
}: Props) {
  const [open, setOpen] = useState(false)

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
            const profileOpen = profileTrackId === track.id
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
                  onClick={() => hasProfile && onToggleProfile(track.id)}
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
        </>
      )}
    </div>
  )
}

/** Chart margins — shared by the SVG and the HTML marker layer sitting on it. */
const CHART_MARGIN = { top: 16, right: 10, bottom: 0, left: 0 }
const CHART_HEIGHT = 120

/**
 * The elevation profile itself, as a strip across the full width of the map —
 * mirroring the chart under the map in the event editor, with the event's
 * points of interest and open incidents marked along it. Hovering reports the
 * coordinate back so the caller can drop a dot on the map at that point on the
 * track.
 */
export function TrackElevationOverlay({
  track,
  pois,
  incidents = [],
  onHoverCoord,
  onClose,
}: {
  track: PanelTrack
  pois: PanelPoi[]
  incidents?: PanelIncident[]
  onHoverCoord: (coord: [number, number] | null) => void
  onClose: () => void
}) {
  // Scrubbing the chart re-renders this component on every mouse move, and the
  // caller rebuilds `track`/`pois` each time — so key the (O(points × vertices))
  // projection on the data itself, not on object identity.
  const poisKey = pois.map(p => `${p.coordinates[0]},${p.coordinates[1]}`).join('|')
  const incidentsKey = incidents.map(p => `${p.coordinates[0]},${p.coordinates[1]}`).join('|')
  const marks = useMemo(
    () => projectMarks(track, pois, incidents),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [track.id, track.coordinates, poisKey, incidentsKey],
  )
  const [hovered, setHovered] = useState<number | null>(null)

  // The y-domain is pinned rather than left on 'auto' so the marker layer can
  // place each icon on the line itself — recharts will not tell us where it put
  // the curve, so both have to agree on the scale up front.
  const elevations = track.elevationProfile.map(p => p.elevation)
  const rawMin = Math.min(...elevations)
  const rawMax = Math.max(...elevations)
  // A dead-flat track would collapse the domain to a single value, which
  // recharts cannot scale — give it a metre of room either side.
  const eleMin = rawMax > rawMin ? rawMin : rawMin - 1
  const eleMax = rawMax > rawMin ? rawMax : rawMax + 1
  const kmMin = track.elevationProfile[0]?.distance ?? 0
  const kmMax = track.elevationProfile[track.elevationProfile.length - 1]?.distance ?? 0

  if (track.elevationProfile.length < 2) return null

  // The profile is smoothed and strided, so re-deriving gain/distance from it
  // undershoots the event's published figures — use those when we have them.
  const gainM = track.ascentMeters ?? totalAscent(track.elevationProfile)
  const lastKm = track.distanceKm ?? kmMax

  /** Profile sample index → the track coordinate it came from. */
  const coordAt = (index: number): [number, number] | null => {
    if (track.coordinates.length === 0) return null
    const ratio = index / Math.max(track.elevationProfile.length - 1, 1)
    return track.coordinates[Math.round(ratio * (track.coordinates.length - 1))] ?? null
  }

  const xPct = (km: number) => (kmMax > kmMin ? ((km - kmMin) / (kmMax - kmMin)) * 100 : 0)
  const yPct = (ele: number) => (eleMax > eleMin ? (1 - (ele - eleMin) / (eleMax - eleMin)) * 100 : 50)

  return (
    <div
      className="absolute bottom-0 left-0 right-0 px-3 pt-2 pb-3"
      style={{
        zIndex: 10,
        background: 'rgba(10,18,34,0.95)',
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(148,163,184,0.18)',
      }}
      onMouseLeave={() => onHoverCoord(null)}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Mountain className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#f97316' }} />
        <span className="text-xs font-medium truncate" style={{ color: '#94a3b8' }}>
          Elevation Profile — {track.name}
        </span>
        <span className="text-xs flex-1 text-right whitespace-nowrap" style={{ color: '#64748b' }}>
          {gainM.toLocaleString()} m gain · {lastKm.toFixed(1)} km
        </span>
        <button
          onClick={onClose}
          title="Close elevation profile"
          className="p-1 rounded-lg flex-shrink-0"
          style={{ color: '#64748b', background: 'rgba(255,255,255,0.04)' }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div style={{ height: CHART_HEIGHT, position: 'relative' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={track.elevationProfile}
            margin={CHART_MARGIN}
            onMouseMove={(state: { activeTooltipIndex?: number }) => {
              if (state?.activeTooltipIndex !== undefined) onHoverCoord(coordAt(state.activeTooltipIndex))
            }}
            onMouseLeave={() => onHoverCoord(null)}
          >
            <defs>
              <linearGradient id={`trkElev-${track.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={track.color} stopOpacity={0.35} />
                <stop offset="95%" stopColor={track.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="distance" type="number" domain={[kmMin, kmMax]} hide />
            <YAxis hide domain={[eleMin, eleMax]} />
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
              stroke={track.color}
              strokeWidth={1.5}
              fill={`url(#trkElev-${track.id})`}
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4, fill: track.color, stroke: 'white', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Points of interest and incidents, snapped onto the profile. Rendered
            over the chart rather than as recharts ReferenceDots so each one can
            carry its own icon and only name itself on hover — a full label per
            point turned a busy course into an unreadable wall of text. */}
        <div
          className="absolute"
          style={{
            top: CHART_MARGIN.top,
            left: CHART_MARGIN.left,
            right: CHART_MARGIN.right,
            bottom: CHART_MARGIN.bottom,
            pointerEvents: 'none',
          }}
        >
          {marks.map((mark, i) => (
            <div
              key={`${mark.kind}-${mark.label}-${i}`}
              className="absolute flex flex-col items-center"
              style={{
                left: `${xPct(mark.km)}%`,
                top: `${yPct(mark.elevation)}%`,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'auto',
                zIndex: hovered === i ? 2 : 1,
              }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(h => (h === i ? null : h))}
            >
              {hovered === i && (
                <span
                  className="absolute whitespace-nowrap text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                  style={{
                    bottom: '100%',
                    marginBottom: 4,
                    background: 'rgba(4,12,24,0.95)',
                    border: `1px solid ${mark.color}66`,
                    color: mark.color,
                    pointerEvents: 'none',
                  }}
                >
                  {mark.label}
                </span>
              )}
              <span
                className="flex items-center justify-center rounded-full"
                style={{
                  width: 18,
                  height: 18,
                  background: 'rgba(4,12,24,0.92)',
                  border: `1.5px solid ${mark.color}`,
                  color: mark.color,
                  boxShadow: hovered === i ? `0 0 0 3px ${mark.color}33` : 'none',
                }}
              >
                {mark.kind === 'incident' ? (
                  <Siren className="w-2.5 h-2.5" />
                ) : (
                  <PoiIcon type={mark.type} icon={mark.icon} size={11} color={mark.color} />
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
