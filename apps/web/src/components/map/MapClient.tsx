'use client'

import { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import MapGL, { Marker, Source, Layer, NavigationControl, Popup } from 'react-map-gl/maplibre'
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { PointOfInterest, POIType } from '@/lib/types'
import type { MedicState } from '@events/contracts'
import { POI_CONFIGS } from '@/lib/constants'
import type { LiveIncident } from '@/hooks/useLiveMap'

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'

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
  /** Live runner locations for heatmap */
  runnerLocations?: Array<{ userId: string; lat: number; lng: number }>
  showHeatmap?: boolean
  /** Live incident markers */
  liveIncidents?: LiveIncident[]
  /** Callback to assign a medic to an incident */
  onAssignIncident?: (incidentId: string, medicId: string) => void
  /** Online medics available for assignment */
  availableMedics?: Array<{ medicId: string; name: string }>
  showControls?: boolean
  hoverCoord?: [number, number]
  hoverCoordColor?: string
  fitBounds?: [[number, number], [number, number]]
  /** POIs available as Go-To destinations */
  availablePois?: PointOfInterest[]
  /** Callback for right-click to add a POI */
  onAddPoi?: (coords: [number, number]) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPOIIcon(type: POIType) {
  const config = POI_CONFIGS.find(p => p.type === type)
  if (!config) return { label: '?', color: '#64748b', bg: '#1e293b' }
  return config
}

function getIconContent(type: POIType): string {
  switch (type) {
    case 'base-medical-camp': return '🏠'
    case 'ambulance': return '🚑'
    case 'medical-point': return '+'
    case 'water-point': return '💧'
    case 'wc': return 'WC'
    case 'wardrobe': return '👕'
    case 'parking': return 'P'
    case 'mrs': return '⛰️'
    case 'custom': return '★'
    default: return '•'
  }
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function POIMarker({ poi, onMove }: { poi: PointOfInterest; onMove?: (id: string, coords: [number, number]) => void }) {
  const config = getPOIIcon(poi.type)
  return (
    <Marker
      key={poi.id}
      longitude={poi.coordinates[0]}
      latitude={poi.coordinates[1]}
      draggable={!!onMove}
      onDragEnd={e => onMove?.(poi.id, [e.lngLat.lng, e.lngLat.lat])}
    >
      <div
        className="flex items-center justify-center rounded-full text-white font-bold text-xs cursor-pointer"
        style={{
          width: poi.type === 'base-medical-camp' ? 34 : 28,
          height: poi.type === 'base-medical-camp' ? 34 : 28,
          background: config.color,
          border: '2px solid rgba(255,255,255,0.9)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          fontSize: poi.type === 'wc' ? 8 : 11,
        }}
        title={poi.name || poi.type}
      >
        {getIconContent(poi.type)}
      </div>
    </Marker>
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
  const openIncidents = incidents.filter(i => i.status !== 'resolved')
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
                  const icon = getIconContent(poi.type as POIType)
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
                        fontSize: 16,
                      }}>
                        {icon}
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
}

function LiveMedicDot({ medic, onAssign, availablePois, openIncidents }: LiveMedicDotProps) {
  const [showPopup, setShowPopup] = useState(false)
  const [showGoTo, setShowGoTo] = useState(false)
  const online = isOnline(medic.lastSeenAt)
  const isGoingTo = medic.status === 'going_to'

  const dotColor = online
    ? isGoingTo ? '#f59e0b' : '#22c55e'
    : '#64748b'

  const ringColor = online
    ? isGoingTo ? 'rgba(245,158,11,0.25)' : 'rgba(34,197,94,0.22)'
    : 'transparent'

  return (
    <>
      <Marker longitude={medic.lng} latitude={medic.lat}>
        <div
          className="relative flex items-center justify-center"
          style={{ cursor: 'pointer' }}
          onClick={() => setShowPopup(v => !v)}
          onContextMenu={e => { e.preventDefault(); setShowPopup(true); setShowGoTo(true) }}
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

// Going-to destination pin
function DestinationPin({ medic }: { medic: MedicState }) {
  if (!medic.destination) return null
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
}

function IncidentMarker({ incident, onAssignIncident, availableMedics = [] }: IncidentMarkerProps) {
  const [showPopup, setShowPopup] = useState(false)
  const [showAssign, setShowAssign] = useState(false)

  const dotColor = incident.status === 'resolved'
    ? '#22c55e'
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
          onClick={() => setShowPopup(v => !v)}
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

// ─── Main component ───────────────────────────────────────────────────────────

// ─── Heatmap constants ────────────────────────────────────────────────────────
const CELL_DEG = 0.0009 // ≈100m
const MAX_EXPECTED = 50

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
  hoverCoord,
  hoverCoordColor = '#f97316',
  fitBounds,
  liveIncidents = [],
  onAssignIncident,
  availableMedics = [],
  availablePois = [],
  onAddPoi,
}: MapClientProps) {
  const mapRef = useRef<MapRef>(null)
  const boundsKey = fitBounds ? JSON.stringify(fitBounds) : null

  // Aggregate runner locations into ~100m grid cells for absolute-scale heatmap
  type HeatCell = { lat: number; lng: number; count: number }
  const heatCells = useMemo((): HeatCell[] => {
    const cells: Map<string, HeatCell> = new Map()
    runnerLocations.forEach(r => {
      const gLat = Math.round(r.lat / CELL_DEG) * CELL_DEG
      const gLng = Math.round(r.lng / CELL_DEG) * CELL_DEG
      const key = `${gLat}:${gLng}`
      const c = cells.get(key)
      if (c) c.count++
      else cells.set(key, { lat: gLat, lng: gLng, count: 1 })
    })
    return Array.from(cells.values())
  }, [runnerLocations])

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
    mapRef.current.fitBounds([[w, s], [e, n]], { padding: 60, duration: 600, maxZoom: 15 })
  }, [boundsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoad = useCallback(() => applyFitBounds(), [applyFitBounds])

  useEffect(() => {
    if (mapRef.current?.isStyleLoaded()) applyFitBounds()
  }, [applyFitBounds])

  const visibleTracks = visibleTrackIds
    ? tracks.filter(t => visibleTrackIds.has(t.id))
    : tracks

  // Build GeoJSON lines for "going_to" medics
  const goingToLines = liveMedics
    .filter(m => m.status === 'going_to' && m.destination && isOnline(m.lastSeenAt))
    .map(m => ({
      medicId: m.medicId,
      coordinates: [[m.lng, m.lat], [m.destination!.lng, m.destination!.lat]] as [number, number][],
    }))

  return (
    <MapGL
      ref={mapRef}
      initialViewState={{ longitude: center[0], latitude: center[1], zoom }}
      mapStyle={MAP_STYLE}
      style={{ width: '100%', height: '100%' }}
      cursor={interactivePOI && selectedPOIType ? 'crosshair' : 'grab'}
      onClick={handleClick}
      onLoad={handleLoad}
      attributionControl={false}
      onContextMenu={(e: MapLayerMouseEvent) => {
        e.preventDefault?.()
        if (onAddPoi) onAddPoi([e.lngLat.lng, e.lngLat.lat])
      }}
    >
      {showControls && (
        <NavigationControl position="bottom-right" showCompass showZoom visualizePitch={false} />
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

      {/* POI markers */}
      {pois.map(poi => (
        <POIMarker key={poi.id} poi={poi} onMove={onPOIMove} />
      ))}

      {/* Static medic markers (wizard / setup) */}
      {medicMarkers.map(m => (
        <StaticMedicMarker key={m.id} marker={m} onMove={onMedicMove} />
      ))}

      {/* Live medic dots */}
      {liveMedics.map(m => (
        <LiveMedicDot
          key={m.medicId}
          medic={m}
          onAssign={onMedicAssign}
          availablePois={availablePois}
          openIncidents={liveIncidents.filter(i => i.status !== 'resolved')}
        />
      ))}

      {/* Going-to destination pins */}
      {liveMedics
        .filter(m => m.status === 'going_to' && m.destination && isOnline(m.lastSeenAt))
        .map(m => <DestinationPin key={`dest-${m.medicId}`} medic={m} />)
      }

      {/* Runner heatmap — absolute scale, 50 people per cell = red */}
      {showHeatmap && runnerLocations.length > 0 && (
        <Source
          id="runner-heat"
          type="geojson"
          data={{
            type: 'FeatureCollection',
            features: heatCells.map(c => ({
              type: 'Feature' as const,
              properties: { w: Math.min(c.count / MAX_EXPECTED, 1) },
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
              'heatmap-opacity': 0.95,
            }}
          />
        </Source>
      )}

      {/* Incident markers */}
      {liveIncidents.map(inc => (
        <IncidentMarker
          key={inc.id}
          incident={inc}
          onAssignIncident={onAssignIncident}
          availableMedics={availableMedics}
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
    </MapGL>
  )
}
