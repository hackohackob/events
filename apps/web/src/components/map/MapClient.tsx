'use client'

import { useRef, useCallback, useEffect, useState, useMemo, Fragment } from 'react'
import MapGL, { Marker, Source, Layer, NavigationControl, Popup } from 'react-map-gl/maplibre'
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapPin } from 'lucide-react'
import type { PointOfInterest, POIType } from '@/lib/types'
import type { MedicState } from '@events/contracts'
import { POI_CONFIGS } from '@/lib/constants'
import { PoiIcon } from '@/lib/poi-icons'
import type { LiveIncident } from '@/hooks/useLiveMap'
import type { StyleSpecification, TerrainSpecification } from 'maplibre-gl'

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'

export type BaseLayer = 'streets' | 'satellite' | 'terrain'

/** Minimal single-source raster style (no glyphs needed — all overlays are line/
 *  heatmap layers or DOM markers). */
function rasterStyle(tiles: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles: [tiles], tileSize: 256, attribution } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  }
}

/** Base map style per selected layer. Satellite + terrain use keyless Esri
 *  rasters; streets is the default Carto vector style. */
function styleFor(base: BaseLayer): string | StyleSpecification {
  if (base === 'satellite')
    return rasterStyle('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', '© Esri, Maxar')
  if (base === 'terrain')
    return rasterStyle('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', '© Esri')
  return MAP_STYLE
}

// 3D terrain elevation: keyless AWS Terrain Tiles (Terrarium encoding), enabled
// while the "terrain" base layer is selected.
const TERRAIN_DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const TERRAIN_EXAGGERATION = 1.3
/** Pitch applied when switching into the 3D terrain view. */
const TERRAIN_PITCH = 60

export interface TrackLayer {
  id: string
  coordinates: [number, number][]
  color: string
}

export interface MedicMarker {
  id: string
  longitude: number
  latitude: number
  initials: string
  gradient: string
  imageUrl?: string
  draggable?: boolean
}

interface MapClientProps {
  center: [number, number]
  zoom?: number
  pois?: PointOfInterest[]
  tracks?: TrackLayer[]
  visibleTrackIds?: Set<string>
  interactivePOI?: boolean
  selectedPOIType?: POIType | null
  onMapClick?: (coords: [number, number]) => void
  onPOIMove?: (id: string, coords: [number, number]) => void
  /** Static medic markers (for event setup/wizard) */
  medicMarkers?: MedicMarker[]
  onMedicMove?: (id: string, coords: [number, number]) => void
  /** Live medic states from WS */
  liveMedics?: MedicState[]
  onMedicAssign?: (medicId: string, destination: { lat: number; lng: number; label: string } | null) => void
  /** Live runner locations for heatmap (recordedAt drives freshness) */
  runnerLocations?: Array<{ userId?: string; lat: number; lng: number; recordedAt?: string }>
  showHeatmap?: boolean
  /** Live incident markers */
  liveIncidents?: LiveIncident[]
  /** Callback to assign a medic to an incident */
  onAssignIncident?: (incidentId: string, medicId: string) => void
  /** Online medics available for assignment */
  availableMedics?: Array<{ medicId: string; name: string }>
  showControls?: boolean
  /** Selected base map layer (streets / satellite / terrain). */
  baseLayer?: BaseLayer
  hoverCoord?: [number, number]
  hoverCoordColor?: string
  fitBounds?: [[number, number], [number, number]]
  /** Imperatively fly the camera to a point (e.g. locating a participant). The
   *  `nonce` makes repeat clicks on the same coordinate re-trigger the flight. */
  focusTarget?: { lng: number; lat: number; nonce: number }
  /** POIs available as Go-To destinations */
  availablePois?: PointOfInterest[]
  /** Callback for right-click to add a POI */
  onAddPoi?: (coords: [number, number]) => void
  /** Clicking an incident → open its detail drawer (map focuses automatically). */
  onIncidentClick?: (incidentId: string) => void
  /** Clicking a medic → open its detail drawer (map focuses automatically). */
  onMedicClick?: (medicId: string) => void
  /** Live participant roster as clickable, identity-carrying dots. */
  participantMarkers?: Array<{ userId: string; lat: number; lng: number; name?: string; bibNumber?: string; freshness?: string; accuracy?: number }>
  /** Show the participant dots layer. */
  showParticipantDots?: boolean
  /** Clicking a participant dot → open the People tab + highlight them. */
  onParticipantClick?: (userId: string) => void
  /** Emphasise one participant's dot (e.g. just located from the roster). */
  highlightedParticipantId?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPOIIcon(type: POIType) {
  const config = POI_CONFIGS.find(p => p.type === type)
  if (!config) return { label: '?', color: '#64748b', bg: '#1e293b' }
  return config
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}

function formatLastSeen(isoTs: string): string {
  const ms = Date.now() - new Date(isoTs).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}

function isOnline(lastSeenAt: string): boolean {
  return Date.now() - new Date(lastSeenAt).getTime() < 90_000
}

// Routes/destinations are explicit server state (cleared on arrival/stand-down),
// not a liveness inference — so they get a much longer staleness window. A
// backgrounded phone reporting every few minutes must not blink its route off
// between pings; only a medic gone for this long drops their drawn path.
const ASSIGNMENT_VISIBLE_MS = 10 * 60_000

function isAssignmentFresh(lastSeenAt: string): boolean {
  return Date.now() - new Date(lastSeenAt).getTime() < ASSIGNMENT_VISIBLE_MS
}

// Freshness coloring, matching the mobile app:
//   0–20 min : green, fresher = more saturated
//   20–40 min: yellow
//   > 40 min : grey
const FRESH_TWENTY_MIN = 20 * 60_000
const FRESH_FORTY_MIN = 40 * 60_000

function freshnessBucket(ageMs: number): 'fresh' | 'warning' | 'stale' {
  if (ageMs >= FRESH_FORTY_MIN) return 'stale'
  if (ageMs >= FRESH_TWENTY_MIN) return 'warning'
  return 'fresh'
}

function freshnessColor(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs >= FRESH_FORTY_MIN) return '#7c8a9c'
  if (ageMs >= FRESH_TWENTY_MIN) return '#f5c518'
  // Interpolate a readable saturated green (age 0) → muted sage (20 min edge).
  // Kept dark enough that white initials stay legible on the dot.
  const t = Math.max(0, Math.min(1, ageMs / FRESH_TWENTY_MIN))
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t)
  const r = lerp(0x16, 0x4d)
  const g = lerp(0xb8, 0x8a)
  const b = lerp(0x5c, 0x68)
  return `rgb(${r}, ${g}, ${b})`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function POIMarker({ poi, onMove }: { poi: PointOfInterest; onMove?: (id: string, coords: [number, number]) => void }) {
  const config = getPOIIcon(poi.type)
  const meta = POI_CONFIGS.find(p => p.type === poi.type)
  const [showPopup, setShowPopup] = useState(false)
  return (
    <>
      <Marker
        key={poi.id}
        longitude={poi.coordinates[0]}
        latitude={poi.coordinates[1]}
        draggable={!!onMove}
        onDragStart={() => setShowPopup(false)}
        onDragEnd={e => onMove?.(poi.id, [e.lngLat.lng, e.lngLat.lat])}
      >
        <div
          className="flex items-center justify-center rounded-full text-white cursor-pointer transition-transform hover:scale-110"
          style={{
            width: poi.type === 'base-medical-camp' ? 34 : 28,
            height: poi.type === 'base-medical-camp' ? 34 : 28,
            background: config.color,
            border: showPopup ? '2px solid #fff' : '2px solid rgba(255,255,255,0.9)',
            boxShadow: showPopup ? `0 0 0 4px ${config.color}55, 0 2px 8px rgba(0,0,0,0.4)` : '0 2px 8px rgba(0,0,0,0.4)',
          }}
          title={poi.name || poi.type}
          onClick={e => { e.stopPropagation(); setShowPopup(v => !v) }}
        >
          <PoiIcon type={poi.type} icon={poi.icon} size={poi.type === 'base-medical-camp' ? 18 : 15} color="#fff" />
        </div>
      </Marker>
      {showPopup && (
        <Popup
          longitude={poi.coordinates[0]}
          latitude={poi.coordinates[1]}
          anchor="bottom"
          offset={poi.type === 'base-medical-camp' ? 22 : 18}
          closeButton={false}
          onClose={() => setShowPopup(false)}
          className="poi-popup"
          maxWidth="280px"
        >
          <div style={{ width: 230 }}>
            {/* Coloured accent strip */}
            <div style={{ height: 4, background: config.color }} />
            <div className="px-3.5 pt-3 pb-3">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 36, height: 36, background: `${config.color}26`, border: `1px solid ${config.color}66` }}>
                  <PoiIcon type={poi.type} icon={poi.icon} size={18} color={config.color} />
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-bold leading-tight truncate" style={{ color: '#f1f6fc' }}>{poi.name || meta?.label || poi.type}</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: config.color }}>{meta?.label ?? poi.type}</div>
                </div>
              </div>
              {poi.description ? (
                <div className="text-[13px] leading-snug mb-2.5 rounded-lg px-2.5 py-2" style={{ color: '#c3d0e0', background: 'rgba(255,255,255,0.04)' }}>{poi.description}</div>
              ) : null}
              <div className="flex items-center gap-1.5 text-[11px] font-mono" style={{ color: '#6b7f9a' }}>
                <MapPin className="w-3 h-3 flex-shrink-0" />
                {poi.coordinates[1].toFixed(5)}, {poi.coordinates[0].toFixed(5)}
              </div>
            </div>
          </div>
        </Popup>
      )}
    </>
  )
}

function StaticMedicMarker({ marker, onMove }: { marker: MedicMarker; onMove?: (id: string, coords: [number, number]) => void }) {
  return (
    <Marker
      longitude={marker.longitude}
      latitude={marker.latitude}
      draggable={!!marker.draggable && !!onMove}
      onDragEnd={e => onMove?.(marker.id, [e.lngLat.lng, e.lngLat.lat])}
    >
      <div
        className="flex items-center justify-center rounded-full text-white font-bold text-xs"
        style={{
          width: 32,
          height: 32,
          background: marker.imageUrl ? undefined : marker.gradient,
          border: '2px solid rgba(255,255,255,0.9)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          flexShrink: 0,
          cursor: marker.draggable ? 'grab' : 'pointer',
        }}
        title={marker.id}
      >
        {marker.imageUrl ? (
          <img src={marker.imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          marker.initials
        )}
      </div>
    </Marker>
  )
}

// ─── GoTo Modal ───────────────────────────────────────────────────────────────

interface GoToModalProps {
  medic: MedicState
  pois: PointOfInterest[]
  incidents: LiveIncident[]
  onAssign: (destination: { lat: number; lng: number; label: string }) => void
  onClose: () => void
}

function GoToModal({ medic, pois, incidents, onAssign, onClose }: GoToModalProps) {
  const openIncidents = incidents.filter(i => i.status !== 'resolved' && i.status !== 'closed' && i.status !== 'archived')
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(5,10,20,0.88)',
        backdropFilter: 'blur(16px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'rgba(8,16,32,0.98)',
          border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: 20,
          padding: '0',
          width: '100%', maxWidth: 520,
          maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 0 60px rgba(245,158,11,0.1), 0 24px 80px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px 16px',
          borderBottom: '1px solid rgba(148,163,184,0.08)',
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: 1.5, marginBottom: 4 }}>
              SEND TO DESTINATION
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#e2e8f0' }}>
              {medic.name}
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(148,163,184,0.12)', color: '#64748b', cursor: 'pointer',
            fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>

        {/* Scrollable content */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 24px 24px' }}>
          {/* POI section */}
          {pois.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: 1.5, marginBottom: 10 }}>
                POINTS OF INTEREST
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pois.map((poi, i) => {
                  const cfg = POI_CONFIGS.find(c => c.type === poi.type)
                  const label = poi.name || cfg?.label || poi.type
                  return (
                    <button
                      key={poi.id || i}
                      onClick={() => onAssign({ lat: poi.coordinates[1], lng: poi.coordinates[0], label })}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px', borderRadius: 12, cursor: 'pointer',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(148,163,184,0.08)',
                        textAlign: 'left', width: '100%',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.08)'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.2)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(148,163,184,0.08)' }}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        background: cfg?.bg ?? '#1e293b',
                        border: `1.5px solid ${cfg?.color ?? '#64748b'}44`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <PoiIcon type={poi.type} icon={poi.icon} size={18} color={cfg?.color ?? '#94a3b8'} />
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{label}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          {poi.coordinates[1].toFixed(4)}, {poi.coordinates[0].toFixed(4)}
                        </div>
                      </div>
                      <div style={{ marginLeft: 'auto', color: '#f59e0b', fontSize: 16 }}>→</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Incidents section */}
          {openIncidents.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: 1.5, marginBottom: 10 }}>
                ACTIVE INCIDENTS
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {openIncidents.map(inc => (
                  <button
                    key={inc.id}
                    onClick={() => onAssign({ lat: inc.lat, lng: inc.lng, label: `Incident: ${inc.type}` })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 12, cursor: 'pointer',
                      background: 'rgba(239,68,68,0.05)',
                      border: '1px solid rgba(239,68,68,0.15)',
                      textAlign: 'left', width: '100%',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.05)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.15)' }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: 'rgba(239,68,68,0.15)', border: '1.5px solid rgba(239,68,68,0.3)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 16, color: '#ef4444', fontWeight: 900,
                    }}>!</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', textTransform: 'capitalize' }}>
                        {inc.type}
                      </div>
                      <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>
                        {inc.status.replace('_', ' ')} · {inc.lat.toFixed(4)}, {inc.lng.toFixed(4)}
                      </div>
                    </div>
                    <div style={{ marginLeft: 'auto', color: '#ef4444', fontSize: 16 }}>→</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {pois.length === 0 && openIncidents.length === 0 && (
            <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, padding: '32px 0' }}>
              No destinations available. Add POIs to the event or create incidents.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── LiveMedicDot ─────────────────────────────────────────────────────────────

interface LiveMedicDotProps {
  medic: MedicState
  onAssign?: (medicId: string, destination: { lat: number; lng: number; label: string } | null) => void
  availablePois?: PointOfInterest[]
  openIncidents?: LiveIncident[]
  /** When set, clicking the dot opens the medic detail drawer instead of a popup. */
  onSelect?: () => void
}

function LiveMedicDot({ medic, onAssign, availablePois, openIncidents, onSelect }: LiveMedicDotProps) {
  const [showPopup, setShowPopup] = useState(false)
  const [showGoTo, setShowGoTo] = useState(false)
  const [flashBlue, setFlashBlue] = useState(false)
  const ageMs = Date.now() - new Date(medic.lastSeenAt).getTime()
  const bucket = freshnessBucket(ageMs)
  // "online" for the dot visuals = anything not yet stale (>40 min).
  const online = bucket !== 'stale'
  // Status visuals matched to the mobile app.
  const isResting = medic.status === 'rest'
  const isStationary = medic.status === 'stationary'
  // Responding to an *active* incident → flashing blue lights (everyone sees it).
  // A medic's route can stay tagged with an incident id after that incident is
  // resolved/closed/archived, so the route-based check is gated on the incident
  // still being open — otherwise the medic keeps flashing for a dead incident.
  const isResponding =
    (openIncidents ?? []).some((i) => (i.responders ?? []).includes(medic.medicId)) ||
    (medic.route?.incidentId
      ? (openIncidents ?? []).some((i) => i.id === medic.route!.incidentId)
      : false)
  const isGoingTo = medic.status === 'going_to'
  const isGoingToPoint = !isResponding && isGoingTo
  const flashing = isResponding && online

  // Responding → the whole dot pulses red/blue (emergency lights).
  useEffect(() => {
    if (!flashing) return
    const t = setInterval(() => setFlashBlue(v => !v), 460)
    return () => clearInterval(t)
  }, [flashing])

  const dotColor = flashing
    ? (flashBlue ? '#2563eb' : '#ef4444')
    : isResting ? '#a78bfa' : freshnessColor(ageMs)

  const ringColor = flashing
    ? (flashBlue ? 'rgba(37,99,235,0.3)' : 'rgba(239,68,68,0.3)')
    : bucket === 'fresh'
      ? isResting ? 'rgba(167,139,250,0.22)' : 'rgba(34,197,94,0.22)'
      : 'transparent'

  return (
    <>
      <Marker longitude={medic.lng} latitude={medic.lat}>
        <div
          className="relative flex items-center justify-center"
          style={{ cursor: 'pointer' }}
          onClick={() => (onSelect ? onSelect() : setShowPopup(v => !v))}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setShowPopup(true) }}
        >
          {/* Pulse ring — only when online */}
          {online && (
            <div
              className="absolute rounded-full animate-ping"
              style={{
                width: 44,
                height: 44,
                background: ringColor,
                animationDuration: '2.5s',
              }}
            />
          )}
          {/* Dot */}
          <div
            className="relative flex items-center justify-center rounded-full text-white font-bold"
            style={{
              width: 32,
              height: 32,
              fontSize: 11,
              background: dotColor,
              border: `2.5px solid ${online ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)'}`,
              boxShadow: online ? `0 2px 12px ${dotColor}88` : '0 2px 6px rgba(0,0,0,0.4)',
              opacity: online ? 1 : 0.65,
            }}
            title={medic.name}
          >
            {getInitials(medic.name)}
          </div>
          {/* Stationary (anchored) / heading-to-point badges */}
          {isStationary && online && (
            <div className="absolute flex items-center justify-center rounded-full" style={{ bottom: -3, right: -3, width: 15, height: 15, background: '#34d399', border: '1.5px solid #04121f', zIndex: 4, fontSize: 8 }}>⚓</div>
          )}
          {isGoingToPoint && online && (
            <div className="absolute flex items-center justify-center rounded-full" style={{ bottom: -3, right: -3, width: 15, height: 15, background: '#fbbf24', border: '1.5px solid #04121f', zIndex: 4, fontSize: 9, color: '#04121f', fontWeight: 900 }}>›</div>
          )}
          {/* Last-seen badge when offline */}
          {!online && (
            <div
              className="absolute -bottom-5 whitespace-nowrap text-center"
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: '#94a3b8',
                background: 'rgba(10,18,34,0.85)',
                borderRadius: 4,
                padding: '1px 4px',
                border: '1px solid rgba(148,163,184,0.15)',
              }}
            >
              {formatLastSeen(medic.lastSeenAt)}
            </div>
          )}
          {/* Going-to indicator */}
          {online && isGoingTo && (
            <div
              className="absolute -top-1 -right-1 flex items-center justify-center rounded-full"
              style={{ width: 14, height: 14, background: '#f59e0b', border: '2px solid #0a1224', fontSize: 7, color: '#fff', fontWeight: 900 }}
            >
              →
            </div>
          )}
        </div>
      </Marker>

      {/* Popup on click */}
      {showPopup && (
        <Popup
          longitude={medic.lng}
          latitude={medic.lat}
          onClose={() => setShowPopup(false)}
          closeButton={false}
          offset={22}
          className="medic-popup"
        >
          <div
            style={{
              background: 'rgba(10,18,34,0.97)',
              border: '1px solid rgba(148,163,184,0.18)',
              borderRadius: 12,
              padding: '12px 14px',
              minWidth: 180,
              color: '#e2e8f0',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{medic.name}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
              {online ? (
                <span style={{ color: isGoingTo ? '#f59e0b' : '#22c55e' }}>
                  {isGoingTo ? `→ ${medic.destination?.label ?? 'en route'}` : 'Available'}
                </span>
              ) : (
                <span>Last seen {formatLastSeen(medic.lastSeenAt)}</span>
              )}
            </div>
            {medic.speed != null && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
                {(medic.speed * 3.6).toFixed(1)} km/h
              </div>
            )}
            {onAssign && online && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => { setShowGoTo(true); setShowPopup(false) }}
                  style={{
                    fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7,
                    background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
                    color: '#f59e0b', cursor: 'pointer'
                  }}
                >
                  Go To →
                </button>
                {isGoingTo && (
                  <button
                    onClick={() => { onAssign(medic.medicId, null); setShowPopup(false) }}
                    style={{
                      fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 7,
                      background: 'rgba(100,116,139,0.15)', border: '1px solid rgba(100,116,139,0.25)',
                      color: '#94a3b8', cursor: 'pointer'
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>
        </Popup>
      )}

      {showGoTo && onAssign && (
        <GoToModal
          medic={medic}
          pois={availablePois ?? []}
          incidents={openIncidents ?? []}
          onAssign={dest => { onAssign(medic.medicId, dest); setShowGoTo(false) }}
          onClose={() => setShowGoTo(false)}
        />
      )}
    </>
  )
}

/** True only for a usable, finite [lng, lat] pair (guards against NaN/null coords). */
function isFiniteLngLat(lng: unknown, lat: unknown): boolean {
  return typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat)
}

// Going-to destination pin
function DestinationPin({ medic }: { medic: MedicState }) {
  if (!medic.destination || !isFiniteLngLat(medic.destination.lng, medic.destination.lat)) return null
  return (
    <Marker longitude={medic.destination.lng} latitude={medic.destination.lat}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <div style={{
          background: 'rgba(10,18,34,0.92)',
          border: '1.5px solid rgba(245,158,11,0.4)',
          borderRadius: 8,
          padding: '3px 7px',
          fontSize: 10,
          fontWeight: 700,
          color: '#f59e0b',
          whiteSpace: 'nowrap',
          maxWidth: 120,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          📍 {medic.destination.label}
        </div>
        <div style={{
          width: 0,
          height: 0,
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: '8px solid rgba(245,158,11,0.7)',
        }} />
      </div>
    </Marker>
  )
}

// ─── Incident marker ──────────────────────────────────────────────────────────

interface IncidentMarkerProps {
  incident: LiveIncident
  onAssignIncident?: (incidentId: string, medicId: string) => void
  availableMedics?: Array<{ medicId: string; name: string }>
  /** When set, clicking the marker opens the incident drawer instead of a popup. */
  onSelect?: () => void
}

function IncidentMarker({ incident, onAssignIncident, availableMedics = [], onSelect }: IncidentMarkerProps) {
  const [showPopup, setShowPopup] = useState(false)
  const [showAssign, setShowAssign] = useState(false)

  // Closed / resolved incidents are greyed out (no longer an active alarm).
  const dotColor = incident.status === 'closed' || incident.status === 'resolved'
    ? '#64748b'
    : incident.status === 'in_progress' || incident.status === 'assigned'
    ? '#f59e0b'
    : '#ef4444'

  const statusLabel = incident.status.replace(/_/g, ' ')
  const canAssign = !!onAssignIncident && incident.status !== 'resolved' && availableMedics.length > 0

  function getMedicInitials(name: string): string {
    return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
  }

  return (
    <>
      <Marker longitude={incident.lng} latitude={incident.lat}>
        <div
          className="relative flex items-center justify-center"
          style={{ cursor: 'pointer' }}
          onClick={() => (onSelect ? onSelect() : setShowPopup(v => !v))}
        >
          {/* Pulse ring for open incidents */}
          {incident.status === 'open' && (
            <div
              className="absolute rounded-full animate-ping"
              style={{ width: 40, height: 40, background: 'rgba(239,68,68,0.25)', animationDuration: '2s' }}
            />
          )}
          <div
            className="relative flex items-center justify-center rounded-full font-black text-white"
            style={{
              width: 28,
              height: 28,
              fontSize: 14,
              background: dotColor,
              border: '2.5px solid rgba(255,255,255,0.9)',
              boxShadow: `0 2px 12px ${dotColor}88`,
            }}
            title={`Incident: ${incident.type}`}
          >
            !
          </div>
          {/* Assigned badge */}
          {(incident.status === 'assigned' || incident.status === 'in_progress') && (
            <div
              style={{
                position: 'absolute', top: -4, right: -4,
                width: 14, height: 14, borderRadius: '50%',
                background: '#f59e0b', border: '2px solid #0a1224',
                fontSize: 8, color: '#fff', fontWeight: 900,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ✓
            </div>
          )}
        </div>
      </Marker>

      {showPopup && (
        <Popup
          longitude={incident.lng}
          latitude={incident.lat}
          onClose={() => { setShowPopup(false); setShowAssign(false) }}
          closeButton={false}
          offset={18}
        >
          <div
            style={{
              background: 'rgba(10,18,34,0.97)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 12,
              padding: '12px 14px',
              minWidth: 200,
              color: '#e2e8f0',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, textTransform: 'capitalize' }}>
              {incident.type}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: dotColor, fontWeight: 600, textTransform: 'capitalize' }}>
                {statusLabel}
              </span>
            </div>
            {incident.description && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>{incident.description}</div>
            )}
            <div style={{ fontSize: 10, color: '#475569', marginBottom: canAssign ? 8 : 0 }}>
              {incident.lat.toFixed(5)}, {incident.lng.toFixed(5)}
            </div>

            {/* Assign responder section */}
            {canAssign && !showAssign && (
              <button
                onClick={() => setShowAssign(true)}
                style={{
                  width: '100%', fontSize: 11, fontWeight: 700, padding: '6px 10px',
                  borderRadius: 7, background: 'rgba(34,197,94,0.12)',
                  border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                + Assign Responder
              </button>
            )}

            {canAssign && showAssign && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: 1, marginBottom: 6 }}>
                  SELECT RESPONDER
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                  {availableMedics.map(m => (
                    <button
                      key={m.medicId}
                      onClick={() => {
                        onAssignIncident!(incident.id, m.medicId)
                        setShowAssign(false)
                        setShowPopup(false)
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(148,163,184,0.1)',
                        color: '#e2e8f0', textAlign: 'left', width: '100%',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(34,197,94,0.1)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                    >
                      <div style={{
                        width: 26, height: 26, borderRadius: '50%',
                        background: 'rgba(34,197,94,0.15)', border: '1.5px solid rgba(34,197,94,0.4)',
                        color: '#22c55e', fontSize: 9, fontWeight: 800,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        {getMedicInitials(m.name)}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{m.name}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowAssign(false)}
                  style={{
                    marginTop: 6, fontSize: 11, color: '#475569', cursor: 'pointer',
                    background: 'none', border: 'none', padding: 0,
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </Popup>
      )}
    </>
  )
}

// ─── Medic navigation routes (shared on the dashboard) ────────────────────────

const ROUTE_SURFACE_COLORS: Record<'road' | 'offroad' | 'path', string> = {
  road: '#3B82F6',
  offroad: '#F4B740',
  path: '#FB5B5B',
}

const DASH_SEQUENCE: number[][] = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
]

/** Below this zoom the per-path ETA blocks are dropped to reduce clutter. */
const ETA_MIN_ZOOM = 12.5

function fmtKm(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`
}

function fmtMins(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000))
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

interface ClippedRoute {
  geometry: [number, number][]
  segments: { surface: 'road' | 'offroad' | 'path'; coordinates: [number, number][] }[]
  remainingMeters: number
  fraction: number
}

/** Clip a route to the part still ahead of [lng, lat], hiding the covered part. */
function clipRouteAhead(
  geometry: [number, number][],
  segments: { surface: 'road' | 'offroad' | 'path'; coordinates: [number, number][] }[],
  pos: [number, number],
): ClippedRoute {
  let total = 0
  for (let i = 1; i < geometry.length; i++) total += haversineM(geometry[i - 1], geometry[i])
  // Snap: nearest vertex + along-distance (good enough at navigation scale).
  let best = { idx: 0, along: 0, dist: Infinity, point: geometry[0] }
  let acc = 0
  for (let i = 0; i < geometry.length; i++) {
    if (i > 0) acc += haversineM(geometry[i - 1], geometry[i])
    const d = haversineM(geometry[i], pos)
    if (d < best.dist) best = { idx: i, along: acc, dist: d, point: geometry[i] }
  }
  const remainingMeters = Math.max(0, total - best.along)
  const fraction = total > 0 ? remainingMeters / total : 0
  const ahead: [number, number][] = geometry.slice(best.idx)
  let segAcc = 0
  const clipped: ClippedRoute['segments'] = []
  for (const seg of segments) {
    const kept: [number, number][] = []
    for (let i = 0; i < seg.coordinates.length; i++) {
      if (i > 0) segAcc += haversineM(seg.coordinates[i - 1], seg.coordinates[i])
      if (segAcc >= best.along) kept.push(seg.coordinates[i])
    }
    if (kept.length >= 2) clipped.push({ surface: seg.surface, coordinates: kept })
  }
  return {
    geometry: ahead.length >= 2 ? ahead : geometry,
    segments: clipped.length > 0 ? clipped : segments,
    remainingMeters,
    fraction,
  }
}

/** Draws every navigating medic's colour-coded route + flowing dash + ETA block. */
function MedicRoutes({ liveMedics, zoom }: { liveMedics: MedicState[]; zoom: number }) {
  const [dash, setDash] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setDash(d => (d + 1) % DASH_SEQUENCE.length), 130)
    return () => clearInterval(t)
  }, [])

  const routed = liveMedics.filter(
    m => m.route && m.route.geometry.length >= 2 && isAssignmentFresh(m.lastSeenAt) && m.route.geometry.every(c => isFiniteLngLat(c[0], c[1])),
  )
  if (routed.length === 0) return null
  const showEta = zoom >= ETA_MIN_ZOOM

  return (
    <>
      {routed.map(m => {
        const route = m.route!
        // Hide the already-covered part + recompute remaining time/ETA from the
        // medic's live position, so the block stays current on every device.
        const clip = clipRouteAhead(route.geometry, route.segments, [m.lng, m.lat])
        const remainingMs = route.durationMs * clip.fraction
        const eta = new Date(Date.now() + remainingMs)
        const etaClock = `${String(eta.getHours()).padStart(2, '0')}:${String(eta.getMinutes()).padStart(2, '0')}`
        const mid = clip.geometry[Math.floor(clip.geometry.length / 2)] ?? clip.geometry[0]
        return (
          <Fragment key={`mr-${m.medicId}`}>
            <Source id={`mr-out-${m.medicId}`} type="geojson" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: clip.geometry } }}>
              <Layer id={`mr-out-l-${m.medicId}`} type="line" layout={{ 'line-join': 'round', 'line-cap': 'round' }} paint={{ 'line-color': 'rgba(8,15,28,0.85)', 'line-width': 6 }} />
            </Source>
            {clip.segments.map((seg, i) => (
              <Source key={`mr-seg-${m.medicId}-${i}`} id={`mr-seg-${m.medicId}-${i}`} type="geojson" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: seg.coordinates } }}>
                <Layer id={`mr-seg-l-${m.medicId}-${i}`} type="line" layout={{ 'line-join': 'round', 'line-cap': 'round' }} paint={{ 'line-color': ROUTE_SURFACE_COLORS[seg.surface], 'line-width': 4, 'line-opacity': 0.92 }} />
              </Source>
            ))}
            <Source id={`mr-flow-${m.medicId}`} type="geojson" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: clip.geometry } }}>
              <Layer id={`mr-flow-l-${m.medicId}`} type="line" layout={{ 'line-join': 'round', 'line-cap': 'round' }} paint={{ 'line-color': 'rgba(255,255,255,0.9)', 'line-width': 2, 'line-dasharray': DASH_SEQUENCE[dash] }} />
            </Source>
            {showEta && (
              <Marker longitude={mid[0]} latitude={mid[1]}>
                <div style={{ background: 'rgba(9,14,24,0.96)', border: '1px solid rgba(96,165,250,0.6)', borderRadius: 11, padding: '5px 10px', textAlign: 'center', boxShadow: '0 2px 9px rgba(0,0,0,0.5)' }}>
                  <div style={{ color: '#fff', fontSize: 15, fontWeight: 900, lineHeight: 1.05 }}>{fmtMins(remainingMs)}</div>
                  <div style={{ color: '#93c5fd', fontSize: 10.5, fontWeight: 800 }}>ETA {etaClock}</div>
                  <div style={{ color: '#7d8ea4', fontSize: 9, fontWeight: 700 }}>{fmtKm(clip.remainingMeters)}</div>
                </div>
              </Marker>
            )}
          </Fragment>
        )
      })}
    </>
  )
}

/** Gently curved arc between two points (airport-style), as [lng,lat] points. */
function arcPoints(a: [number, number], b: [number, number], segments = 28, curvature = 0.18): [number, number][] {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1e-9
  const cx = (a[0] + b[0]) / 2 + (-dy / len) * len * curvature
  const cy = (a[1] + b[1]) / 2 + (dx / len) * len * curvature
  const pts: [number, number][] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    pts.push([
      (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * cx + t ** 2 * b[0],
      (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * cy + t ** 2 * b[1],
    ])
  }
  return pts
}

/**
 * Curved, flowing "Assigned" lines from responding medics to their incident —
 * shown before they start navigating (no route yet). Replaced by the coloured
 * route once navigation begins.
 */
function AssignedRoutes({ liveMedics, liveIncidents }: { liveMedics: MedicState[]; liveIncidents: LiveIncident[] }) {
  const [dash, setDash] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setDash(d => (d + 1) % DASH_SEQUENCE.length), 130)
    return () => clearInterval(t)
  }, [])

  const medicById = new Map(liveMedics.map(m => [m.medicId, m]))
  const links: { key: string; arc: [number, number][]; mid: [number, number] }[] = []
  for (const inc of liveIncidents) {
    if (inc.status === 'resolved' || inc.status === 'closed' || !isFiniteLngLat(inc.lng, inc.lat)) continue
    for (const medicId of inc.responders ?? []) {
      const m = medicById.get(medicId)
      if (!m || m.route || !isFiniteLngLat(m.lng, m.lat) || !isAssignmentFresh(m.lastSeenAt)) continue
      const arc = arcPoints([m.lng, m.lat], [inc.lng, inc.lat])
      links.push({ key: `${inc.id}-${medicId}`, arc, mid: arc[Math.floor(arc.length / 2)] })
    }
  }
  if (links.length === 0) return null

  return (
    <>
      {links.map(link => (
        <Fragment key={`as-${link.key}`}>
          <Source id={`as-glow-${link.key}`} type="geojson" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: link.arc } }}>
            <Layer id={`as-glow-l-${link.key}`} type="line" layout={{ 'line-join': 'round', 'line-cap': 'round' }} paint={{ 'line-color': 'rgba(239,68,68,0.45)', 'line-width': 7, 'line-blur': 4 }} />
          </Source>
          <Source id={`as-base-${link.key}`} type="geojson" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: link.arc } }}>
            <Layer id={`as-base-l-${link.key}`} type="line" layout={{ 'line-join': 'round', 'line-cap': 'round' }} paint={{ 'line-color': 'rgba(220,38,38,0.85)', 'line-width': 3.5 }} />
          </Source>
          <Source id={`as-flow-${link.key}`} type="geojson" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: link.arc } }}>
            <Layer id={`as-flow-l-${link.key}`} type="line" layout={{ 'line-join': 'round', 'line-cap': 'round' }} paint={{ 'line-color': '#fecaca', 'line-width': 2.2, 'line-dasharray': DASH_SEQUENCE[dash] }} />
          </Source>
          <Marker longitude={link.mid[0]} latitude={link.mid[1]}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#dc2626', border: '1.5px solid rgba(255,255,255,0.5)', borderRadius: 999, padding: '3px 10px', color: '#fff', fontSize: 10.5, fontWeight: 900, letterSpacing: 0.4, boxShadow: '0 0 8px rgba(239,68,68,0.7)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />Assigned
            </div>
          </Marker>
        </Fragment>
      ))}
    </>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

// ─── Heatmap constants ────────────────────────────────────────────────────────
const CELL_DEG = 0.0009 // ≈100m
const MAX_EXPECTED = 50
const DEFAULT_TRUST_MIN = 40 // hide pings older than this (coordinator-adjustable)

/** Freshness weight: 1 at now, decaying linearly to ~0 at the trust window so
 *  stale pings (where runners have moved on) contribute far less heat. */
function freshnessWeight(ageMin: number, trustMin: number): number {
  if (ageMin >= trustMin) return 0
  return Math.max(0.05, 1 - ageMin / trustMin)
}

/** Age → colour for individual freshness dots. */
function ageColor(ageMin: number): string {
  if (ageMin < 5) return '#22c55e' // fresh
  if (ageMin < 15) return '#14b8a6' // recent
  if (ageMin < 30) return '#f59e0b' // aging
  return '#8a97a8' // stale
}

const PARTICIPANT_FRESH: Record<string, string> = {
  fresh: '#22c55e', warning: '#f59e0b', stale: '#f97316', offline: '#64748b',
}

/** Build a GeoJSON circle polygon (in degrees) approximating a real-world
 *  radius in meters — used for the GPS accuracy halo, à la Google Maps' blue
 *  dot. Scales correctly with zoom since it's real geometry, not a fixed
 *  pixel-radius marker. */
function circlePolygon(lng: number, lat: number, radiusMeters: number, points = 48) {
  const coords: [number, number][] = []
  const earthRadius = 6371000
  const latRad = (lat * Math.PI) / 180
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI
    const dx = (radiusMeters * Math.cos(angle)) / (earthRadius * Math.cos(latRad))
    const dy = (radiusMeters * Math.sin(angle)) / earthRadius
    coords.push([lng + (dx * 180) / Math.PI, lat + (dy * 180) / Math.PI])
  }
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [coords] } }
}

/** Translucent halo showing GPS accuracy radius (meters) around a participant
 *  dot — mirrors how other radius/corridor overlays in this file are drawn as
 *  a GeoJSON Source + fill/line Layer pair. */
function ParticipantAccuracyCircle({ lng, lat, radiusMeters, color }: {
  lng: number
  lat: number
  radiusMeters: number
  color: string
}) {
  const data = useMemo(() => circlePolygon(lng, lat, radiusMeters), [lng, lat, radiusMeters])
  return (
    <Source type="geojson" data={data}>
      <Layer
        type="fill"
        paint={{ 'fill-color': color, 'fill-opacity': 0.15 }}
      />
      <Layer
        type="line"
        paint={{ 'line-color': color, 'line-opacity': 0.5, 'line-width': 1.5 }}
      />
    </Source>
  )
}

/** A clickable, identity-carrying participant dot from the live roster. The
 *  highlighted one (just located, or clicked in the panel) gets a pulse + label. */
function ParticipantDot({ p, highlighted, onSelect }: {
  p: { userId: string; lat: number; lng: number; name?: string; bibNumber?: string; freshness?: string; accuracy?: number }
  highlighted: boolean
  onSelect?: () => void
}) {
  const color = PARTICIPANT_FRESH[p.freshness ?? 'offline'] ?? '#64748b'
  const size = highlighted ? 16 : 11
  return (
    <Marker longitude={p.lng} latitude={p.lat}>
      <div
        className="relative flex items-center justify-center"
        style={{ cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); onSelect?.() }}
        title={`${p.bibNumber ? '#' + p.bibNumber + ' · ' : ''}${p.name ?? 'Participant'}`}
      >
        {highlighted && (
          <div className="absolute rounded-full animate-ping" style={{ width: 30, height: 30, background: `${color}55`, animationDuration: '1.6s' }} />
        )}
        <div
          style={{
            width: size, height: size, borderRadius: '50%', background: color,
            border: `2px solid ${highlighted ? '#ffffff' : 'rgba(255,255,255,0.85)'}`,
            boxShadow: highlighted ? `0 0 12px ${color}` : '0 1px 3px rgba(0,0,0,0.45)',
            transition: 'width 0.15s, height 0.15s',
          }}
        />
        {highlighted && (
          <div
            className="absolute whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] font-bold"
            style={{ top: -22, background: 'rgba(8,15,28,0.92)', color: '#e2e8f0', border: '1px solid rgba(34,197,94,0.4)' }}
          >
            {p.bibNumber ? `#${p.bibNumber}` : (p.name ?? 'Participant')}
          </div>
        )}
      </div>
    </Marker>
  )
}

export default function MapClient({
  center,
  zoom = 12,
  pois = [],
  tracks = [],
  visibleTrackIds,
  interactivePOI = false,
  selectedPOIType,
  onMapClick,
  onPOIMove,
  medicMarkers = [],
  onMedicMove,
  liveMedics = [],
  onMedicAssign,
  runnerLocations = [],
  showHeatmap = false,
  showControls = true,
  baseLayer = 'streets',
  hoverCoord,
  hoverCoordColor = '#f97316',
  fitBounds,
  focusTarget,
  liveIncidents = [],
  onAssignIncident,
  availableMedics = [],
  availablePois = [],
  onAddPoi,
  onIncidentClick,
  onMedicClick,
  participantMarkers = [],
  showParticipantDots = false,
  onParticipantClick,
  highlightedParticipantId,
}: MapClientProps) {
  const mapRef = useRef<MapRef>(null)
  const [liveZoom, setLiveZoom] = useState(zoom)
  // Heatmap freshness: re-tick so ages keep decaying live; trust window filters.
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [trustMin, setTrustMin] = useState(DEFAULT_TRUST_MIN)
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  // Centre a point in the part of the map the user can actually see, not the
  // raw map element. On desktop the left panel is a flex sibling (already
  // excluded from the map box), but a right-side detail drawer (incident/medic,
  // ~440px) slides over the map — pad right by that much when one is open so the
  // point doesn't land behind it. Locating a participant opens the left People
  // tab, not a right drawer, so it passes `rightDrawer: false` and centres in
  // the full visible map.
  const focusOn = (lng: number, lat: number, opts?: { rightDrawer?: boolean }) => {
    const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024
    const rightPad = isDesktop && (opts?.rightDrawer ?? true) ? 440 : 0
    mapRef.current?.flyTo({
      center: [lng, lat],
      zoom: Math.max(liveZoom, 15.5),
      duration: 650,
      padding: { top: 0, bottom: 0, left: 0, right: rightPad },
    })
  }
  // Imperative focus (locate a participant from the side panel): fly there each
  // time the nonce changes, even if the coordinate is identical.
  useEffect(() => {
    if (!focusTarget) return
    focusOn(focusTarget.lng, focusTarget.lat, { rightDrawer: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget?.nonce])

  // Tilt into a 3D perspective when the terrain base layer is picked, and flatten
  // back to a top-down view when leaving it (terrain looks broken at pitch 0 only
  // in the sense that you can't see it — the tilt is what sells the relief).
  const is3dTerrain = baseLayer === 'terrain'
  // `null` (not undefined) is required to actively clear terrain when leaving the
  // terrain layer — undefined means "don't touch". The prop type only admits
  // undefined, but the runtime handles null (setTerrain(null)).
  const terrainProp = (
    is3dTerrain ? { source: 'terrain-dem', exaggeration: TERRAIN_EXAGGERATION } : null
  ) as TerrainSpecification | undefined
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.easeTo({ pitch: is3dTerrain ? TERRAIN_PITCH : 0, duration: 800 })
  }, [is3dTerrain])

  const boundsKey = fitBounds ? JSON.stringify(fitBounds) : null

  // Aggregate runner locations into ~100m grid cells, weighting each ping by
  // freshness so a stale crowd no longer reads as a hot "now" crowd. Also build
  // per-runner freshness dots (for close zoom) + summary stats for the panel.
  const { heatCells, freshnessDots, heatStats } = useMemo(() => {
    const cells = new Map<string, { lat: number; lng: number; weight: number }>()
    const dotFeatures: Array<{ type: 'Feature'; properties: { color: string; ageMin: number }; geometry: { type: 'Point'; coordinates: [number, number] } }> = []
    const ages: number[] = []
    runnerLocations.forEach(r => {
      const ageMin = r.recordedAt ? (nowTick - new Date(r.recordedAt).getTime()) / 60_000 : trustMin
      if (ageMin >= trustMin || ageMin < 0) return // outside the trust window
      ages.push(ageMin)
      const w = freshnessWeight(ageMin, trustMin)
      const gLat = Math.round(r.lat / CELL_DEG) * CELL_DEG
      const gLng = Math.round(r.lng / CELL_DEG) * CELL_DEG
      const key = `${gLat}:${gLng}`
      const c = cells.get(key)
      if (c) c.weight += w
      else cells.set(key, { lat: gLat, lng: gLng, weight: w })
      dotFeatures.push({
        type: 'Feature',
        properties: { color: ageColor(ageMin), ageMin: Math.round(ageMin) },
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      })
    })
    ages.sort((a, b) => a - b)
    return {
      heatCells: Array.from(cells.values()),
      freshnessDots: { type: 'FeatureCollection' as const, features: dotFeatures },
      heatStats: {
        count: ages.length,
        medianMin: ages.length ? Math.round(ages[Math.floor(ages.length / 2)]) : 0,
        oldestMin: ages.length ? Math.round(ages[ages.length - 1]) : 0,
      },
    }
  }, [runnerLocations, nowTick, trustMin])

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (!interactivePOI || !selectedPOIType || !onMapClick) return
      onMapClick([e.lngLat.lng, e.lngLat.lat])
    },
    [interactivePOI, selectedPOIType, onMapClick]
  )

  const applyFitBounds = useCallback(() => {
    if (!fitBounds || !mapRef.current) return
    const [[w, s], [e, n]] = fitBounds
    if (w === e && s === n) return
    const map = mapRef.current.getMap()
    // Keep the user's current rotation/tilt — fitBounds defaults bearing/pitch to
    // 0, which would snap the map back to north-up when toggling track visibility.
    mapRef.current.fitBounds([[w, s], [e, n]], {
      padding: 60,
      duration: 600,
      maxZoom: 15,
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    })
  }, [boundsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoad = useCallback(() => applyFitBounds(), [applyFitBounds])

  useEffect(() => {
    if (mapRef.current?.isStyleLoaded()) applyFitBounds()
  }, [applyFitBounds])

  const visibleTracks = visibleTrackIds
    ? tracks.filter(t => visibleTrackIds.has(t.id))
    : tracks

  // Build GeoJSON lines for "going_to" medics
  // Medics assigned/responding to an open incident — they get the curved
  // "Assigned" line, so suppress the straight going-to dashed line for them.
  const responderIds = new Set(
    liveIncidents.flatMap(i => (i.status === 'resolved' || i.status === 'closed' ? [] : i.responders ?? [])),
  )
  const goingToLines = liveMedics
    .filter(
      m =>
        m.status === 'going_to' &&
        m.destination &&
        !m.route &&
        !responderIds.has(m.medicId) &&
        isAssignmentFresh(m.lastSeenAt) &&
        isFiniteLngLat(m.lng, m.lat) &&
        isFiniteLngLat(m.destination.lng, m.destination.lat),
    )
    .map(m => ({
      medicId: m.medicId,
      coordinates: [[m.lng, m.lat], [m.destination!.lng, m.destination!.lat]] as [number, number][],
    }))

  return (
    <MapGL
      ref={mapRef}
      initialViewState={{ longitude: center[0], latitude: center[1], zoom }}
      mapStyle={styleFor(baseLayer)}
      terrain={terrainProp}
      maxPitch={70}
      style={{ width: '100%', height: '100%' }}
      cursor={interactivePOI && selectedPOIType ? 'crosshair' : 'grab'}
      onClick={handleClick}
      onLoad={handleLoad}
      onMoveEnd={(e) => setLiveZoom(e.viewState.zoom)}
      attributionControl={false}
      onContextMenu={(e: MapLayerMouseEvent) => {
        e.preventDefault?.()
        if (onAddPoi) onAddPoi([e.lngLat.lng, e.lngLat.lat])
      }}
    >
      {showControls && (
        <NavigationControl position="bottom-right" showCompass showZoom visualizePitch={is3dTerrain} />
      )}

      {/* Elevation source for the 3D terrain view (keyless AWS Terrarium DEM). */}
      {is3dTerrain && (
        <Source
          id="terrain-dem"
          type="raster-dem"
          tiles={[TERRAIN_DEM_TILES]}
          encoding="terrarium"
          tileSize={256}
          maxzoom={15}
        />
      )}

      {/* Track layers */}
      {visibleTracks.map(track => (
        <Source
          key={track.id}
          id={`track-${track.id}`}
          type="geojson"
          data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: track.coordinates } }}
        >
          <Layer
            id={`track-line-${track.id}`}
            type="line"
            paint={{ 'line-color': track.color, 'line-width': 3, 'line-opacity': 0.9 }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
        </Source>
      ))}

      {/* Going-to lines */}
      {goingToLines.map(line => (
        <Source
          key={`going-${line.medicId}`}
          id={`going-${line.medicId}`}
          type="geojson"
          data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line.coordinates } }}
        >
          <Layer
            id={`going-line-${line.medicId}`}
            type="line"
            paint={{
              'line-color': '#f59e0b',
              'line-width': 2.5,
              'line-opacity': 0.8,
              'line-dasharray': [6, 3],
            }}
          />
        </Source>
      ))}

      {/* Shared medic navigation routes (colour-coded + flowing + ETA) */}
      <AssignedRoutes liveMedics={liveMedics} liveIncidents={liveIncidents} />
      <MedicRoutes liveMedics={liveMedics} zoom={liveZoom} />

      {/* POI markers */}
      {pois.map(poi => (
        <POIMarker key={poi.id} poi={poi} onMove={onPOIMove} />
      ))}

      {/* Static medic markers (wizard / setup) */}
      {medicMarkers.map(m => (
        <StaticMedicMarker key={m.id} marker={m} onMove={onMedicMove} />
      ))}

      {/* Live medic dots */}
      {liveMedics.filter(m => isFiniteLngLat(m.lng, m.lat)).map(m => (
        <LiveMedicDot
          key={m.medicId}
          medic={m}
          onAssign={onMedicAssign}
          availablePois={availablePois}
          openIncidents={liveIncidents.filter(i => i.status !== 'resolved' && i.status !== 'closed' && i.status !== 'archived')}
          onSelect={onMedicClick ? () => { focusOn(m.lng, m.lat); onMedicClick(m.medicId) } : undefined}
        />
      ))}

      {/* Going-to destination pins — suppressed when a route or assigned line shows. */}
      {liveMedics
        .filter(m => m.status === 'going_to' && m.destination && !m.route && !responderIds.has(m.medicId) && isAssignmentFresh(m.lastSeenAt))
        .map(m => <DestinationPin key={`dest-${m.medicId}`} medic={m} />)
      }

      {/* Runner heatmap — freshness-weighted density. Fades out as you zoom in,
          where individual freshness dots take over. */}
      {showHeatmap && heatCells.length > 0 && (
        <Source
          id="runner-heat"
          type="geojson"
          data={{
            type: 'FeatureCollection',
            features: heatCells.map(c => ({
              type: 'Feature' as const,
              properties: { w: Math.min(c.weight / MAX_EXPECTED, 1) },
              geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
            })),
          }}
        >
          <Layer
            id="runner-heat-layer"
            type="heatmap"
            paint={{
              'heatmap-weight': ['get', 'w'],
              'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 4, 18, 7],
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0,    'rgba(0,0,0,0)',
                0.1,  'rgba(0,40,120,0.8)',
                0.3,  'rgba(20,90,200,0.92)',
                0.5,  'rgba(100,180,60,0.97)',
                0.75, 'rgba(240,140,20,1)',
                1,    'rgba(180,10,10,1)',
              ],
              'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 18, 13, 30, 16, 50, 18, 70],
              // fade the blob out at close zoom so the dots read clearly
              'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.95, 16, 0.55, 17.5, 0.15],
            }}
          />
        </Source>
      )}

      {/* Individual freshness dots — appear as you zoom in, coloured by age */}
      {showHeatmap && freshnessDots.features.length > 0 && (
        <Source id="runner-dots" type="geojson" data={freshnessDots}>
          <Layer
            id="runner-dots-layer"
            type="circle"
            paint={{
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2, 16, 5, 18, 8],
              'circle-color': ['get', 'color'],
              'circle-stroke-width': 1.5,
              'circle-stroke-color': 'rgba(255,255,255,0.85)',
              'circle-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 16, 0.9],
              'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 16, 0.9],
            }}
          />
        </Source>
      )}

      {/* Live participant dots (identity-carrying, clickable → People tab) */}
      {showParticipantDots && participantMarkers.filter(p => isFiniteLngLat(p.lng, p.lat)).map(p => {
        const isHighlighted = p.userId === highlightedParticipantId
        return (
          <Fragment key={p.userId}>
            {isHighlighted && p.accuracy != null && p.accuracy > 0 && (
              <ParticipantAccuracyCircle
                lng={p.lng}
                lat={p.lat}
                radiusMeters={p.accuracy}
                color={PARTICIPANT_FRESH[p.freshness ?? 'offline'] ?? '#64748b'}
              />
            )}
            <ParticipantDot
              p={p}
              highlighted={isHighlighted}
              onSelect={() => { focusOn(p.lng, p.lat, { rightDrawer: false }); onParticipantClick?.(p.userId) }}
            />
          </Fragment>
        )
      })}

      {/* Incident markers */}
      {liveIncidents.map(inc => (
        <IncidentMarker
          key={inc.id}
          incident={inc}
          onAssignIncident={onAssignIncident}
          availableMedics={availableMedics}
          onSelect={onIncidentClick ? () => { focusOn(inc.lng, inc.lat); onIncidentClick(inc.id) } : undefined}
        />
      ))}

      {/* Elevation profile hover dot */}
      {hoverCoord && (
        <Marker longitude={hoverCoord[0]} latitude={hoverCoord[1]}>
          <div
            style={{
              width: 14, height: 14, borderRadius: '50%',
              background: hoverCoordColor,
              border: '2.5px solid white',
              boxShadow: `0 0 10px ${hoverCoordColor}99`,
              pointerEvents: 'none',
            }}
          />
        </Marker>
      )}

      {/* Heatmap freshness panel: live count, median/oldest age, legend + trust slider */}
      {showHeatmap && (
        <div
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            width: 232,
            padding: '12px 14px',
            borderRadius: 14,
            background: 'rgba(10,20,36,0.82)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            color: '#f1f5f9',
            fontSize: 12,
            zIndex: 5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
            <span style={{ fontWeight: 800, fontSize: 13 }}>{heatStats.count} runners</span>
            <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 11 }}>live density</span>
          </div>
          <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
            <div>
              <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Median age</div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{heatStats.medianMin} min</div>
            </div>
            <div>
              <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Oldest</div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{heatStats.oldestMin} min</div>
            </div>
          </div>
          {/* Freshness legend (dot colours at close zoom) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginBottom: 10 }}>
            {[
              ['#22c55e', '<5m'],
              ['#14b8a6', '<15m'],
              ['#f59e0b', '<30m'],
              ['#8a97a8', 'older'],
            ].map(([c, label]) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#cbd5e1', fontSize: 11 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: c }} />
                {label}
              </span>
            ))}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>
            Trust window: <span style={{ color: '#f1f5f9', fontWeight: 700 }}>{trustMin} min</span>
          </div>
          <input
            type="range"
            min={10}
            max={90}
            step={5}
            value={trustMin}
            onChange={e => setTrustMin(Number(e.target.value))}
            style={{ width: '100%', accentColor: '#22c55e' }}
          />
        </div>
      )}
    </MapGL>
  )
}
