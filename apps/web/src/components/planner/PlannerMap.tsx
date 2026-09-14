'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapGL, { Layer, Marker, NavigationControl, Source } from 'react-map-gl/maplibre'
import type { MapLayerMouseEvent, MapRef } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { VEHICLE_TYPE_META } from '@events/contracts'
import type { PlanMedic, VehicleType } from '@events/contracts'
import { styleFor, type BaseLayer } from '@/lib/map-styles'
import { PoiIcon } from '@/lib/poi-icons'
import { POI_CONFIGS } from '@/lib/constants'
import type { PointOfInterest } from '@/lib/types'
import { DENSITY_BINS, type FieldState } from '@/lib/planner/field'
import { pointAtMeters } from '@/lib/planner/course'
import type { PlannerDiscipline } from '@/hooks/usePlanner'
import type { CoverageReport } from '@/lib/planner/coverage'
import type { MedicPosition } from '@/lib/planner/schedule'

export interface PlannedMedicView {
  medic: PlanMedic
  /** The vehicle this medic is on at the playhead, not their base vehicle. */
  vehicleType: VehicleType
  position: MedicPosition | null
  /** The whole day's route, in order — drawn when the medic is selected. */
  routePoints: Array<{ id: string; lng: number; lat: number; label: string; arriveMs: number }>
}

interface Props {
  center: [number, number]
  baseLayer: BaseLayer
  disciplines: PlannerDiscipline[]
  fields: Record<string, FieldState>
  /** Disciplines the user has hidden on the map. */
  hiddenDisciplineIds: Set<string>
  pois: PointOfInterest[]
  medicViews: PlannedMedicView[]
  selectedMedicId: string | null
  onSelectMedic: (id: string | null) => void
  /** A map click chose a position for the selected medic — adds a posting. */
  onPlaceStation: (medicId: string, lngLat: [number, number]) => void
  /** A puck was dragged — relocates the posting the medic is currently on. */
  onDragStation: (medicId: string, lngLat: [number, number]) => void
  /** Nearest POI within snapping range of a coordinate, if any. */
  snapTarget: (lngLat: [number, number]) => PointOfInterest | null
  fitBounds?: [[number, number], [number, number]]
  showRunners: boolean
  showDensity: boolean
  /** Reach analysis per discipline; drives the course colouring in gaps mode. */
  coverage: Record<string, CoverageReport>
  coverageMeters: number
  /** Sweep windows, so a sweeping medic's puck reads differently. */
  sweepColors: Record<string, string>
}

// ─── Course painting ─────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgba(c: [number, number, number], alpha: number): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha.toFixed(3)})`
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/**
 * Colour for a stretch of course carrying `density` of the field: the
 * discipline's own hue where the field is thin, burning towards a hot amber
 * white where it bunches up. Empty course keeps a dim trace of the hue, so the
 * route is always legible even where nobody is running yet.
 */
function densityColor(hex: string, density: number): string {
  const base = hexToRgb(hex)
  if (density <= 0.002) return rgba(base, 0.34)
  const heat = Math.min(1, density * 1.45)
  const hot: [number, number, number] = [255, 246, 214]
  return rgba(mix(base, hot, Math.pow(heat, 1.6)), 0.6 + 0.4 * Math.min(1, density * 2.2))
}

/**
 * Reach ramp, keyed on "how many radii away is the nearest medic".
 *
 * Deliberately not the discipline's own hue: when the coverage view is on, a
 * course drawn in its own red or orange reads as a course in trouble. In this
 * mode colour means one thing only — green is covered, red is not.
 */
const REACH_RAMP: Array<[number, [number, number, number]]> = [
  [0.0, [34, 197, 94]],
  [0.75, [132, 204, 22]],
  [1.0, [250, 204, 21]],
  [1.5, [249, 115, 22]],
  [2.2, [239, 68, 68]],
]

/** Slate for course nobody is on — present, but plainly out of play. */
const IDLE_COURSE: [number, number, number] = [148, 163, 184]

function reachColor(nearestMeters: number, radiusMeters: number, occupied: boolean): string {
  if (!occupied) return rgba(IDLE_COURSE, 0.42)
  const ratio = radiusMeters > 0 ? nearestMeters / radiusMeters : Number.POSITIVE_INFINITY
  if (!Number.isFinite(ratio)) return rgba(REACH_RAMP[REACH_RAMP.length - 1][1], 0.98)
  for (let i = 1; i < REACH_RAMP.length; i += 1) {
    const [stop, color] = REACH_RAMP[i]
    const [prevStop, prevColor] = REACH_RAMP[i - 1]
    if (ratio <= stop) {
      const t = stop === prevStop ? 0 : (ratio - prevStop) / (stop - prevStop)
      return rgba(mix(prevColor, color, t), 0.98)
    }
  }
  return rgba(REACH_RAMP[REACH_RAMP.length - 1][1], 0.98)
}

/** MapLibre `line-gradient` expression from a per-bin colour function. */
function gradientExpression(colorAt: (bin: number) => string): unknown[] {
  const stops: unknown[] = ['interpolate', ['linear'], ['line-progress']]
  stops.push(0, colorAt(0))
  for (let i = 0; i < DENSITY_BINS; i += 1) {
    stops.push(Math.min(0.999, (i + 0.5) / DENSITY_BINS), colorAt(i))
  }
  stops.push(1, colorAt(DENSITY_BINS - 1))
  return stops
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PlannerMap({
  center,
  baseLayer,
  disciplines,
  fields,
  hiddenDisciplineIds,
  pois,
  medicViews,
  selectedMedicId,
  onSelectMedic,
  onPlaceStation,
  onDragStation,
  snapTarget,
  fitBounds,
  showRunners,
  showDensity,
  coverage,
  coverageMeters,
  sweepColors,
}: Props) {
  const mapRef = useRef<MapRef>(null)
  const [dragSnapId, setDragSnapId] = useState<string | null>(null)
  const [hoverMedicId, setHoverMedicId] = useState<string | null>(null)

  // The first fit usually lands before the style has finished loading, and
  // maplibre silently drops a camera move made in that window — so the pending
  // bounds are replayed on load as well as applied on change.
  const pendingBounds = useRef<Props['fitBounds']>(undefined)
  const applyBounds = useCallback((box: Props['fitBounds']) => {
    const map = mapRef.current
    if (!box) return
    if (!map || !map.isStyleLoaded()) {
      pendingBounds.current = box
      return
    }
    pendingBounds.current = undefined
    map.fitBounds(box, { padding: 80, duration: 900 })
  }, [])

  useEffect(() => {
    applyBounds(fitBounds)
  }, [fitBounds, applyBounds])

  const visible = useMemo(
    () => disciplines.filter(d => d.hasCourse && !hiddenDisciplineIds.has(d.id)),
    [disciplines, hiddenDisciplineIds],
  )

  // In gaps mode the colour of every course means reach, not discipline; in
  // field mode it means where the runners are. One or the other, never both —
  // two meanings on one line is what made the old view hard to read.
  const trackData = useMemo(
    () =>
      visible.map(d => {
        const density = fields[d.id]?.density ?? []
        const report = coverage[d.id]
        const reachMode = report != null && report.nearest.length > 0
        return {
          id: d.id,
          color: d.color,
          reachMode,
          geojson: {
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'LineString' as const, coordinates: d.course.coordinates },
          },
          gradient: reachMode
            ? gradientExpression(bin =>
                reachColor(report.nearest[bin] ?? Number.POSITIVE_INFINITY, coverageMeters, report.occupied[bin] ?? false),
              )
            : gradientExpression(bin => densityColor(d.color, density[bin] ?? 0)),
          hasSeries: reachMode || density.length > 0,
        }
      }),
    [visible, fields, coverage, coverageMeters],
  )

  const runnerDots = useMemo(() => {
    if (!showRunners) return null
    const features = visible.flatMap(d =>
      (fields[d.id]?.dots ?? []).map(coord => ({
        type: 'Feature' as const,
        properties: { color: d.color },
        geometry: { type: 'Point' as const, coordinates: coord },
      })),
    )
    return { type: 'FeatureCollection' as const, features }
  }, [visible, fields, showRunners])

  /** Leader + tail badges, so "who is still out there" is legible at a glance. */
  const edgeMarkers = useMemo(
    () =>
      visible.flatMap(d => {
        const field = fields[d.id]
        if (!field || field.onCourse <= 0) return []
        const out: Array<{ key: string; lngLat: [number, number]; label: string; color: string; kind: 'leader' | 'tail' }> = []
        if (field.leaderMeters >= 0) {
          out.push({
            key: `${d.id}-leader`,
            lngLat: pointAtMeters(d.course, field.leaderMeters),
            label: `${(field.leaderMeters / 1000).toFixed(1)} km`,
            color: d.color,
            kind: 'leader',
          })
        }
        if (field.tailMeters >= 0 && field.tailMeters < field.leaderMeters - 200) {
          out.push({
            key: `${d.id}-tail`,
            lngLat: pointAtMeters(d.course, field.tailMeters),
            label: `${(field.tailMeters / 1000).toFixed(1)} km`,
            color: d.color,
            kind: 'tail',
          })
        }
        return out
      }),
    [visible, fields],
  )

  const coverageGaps = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: visible.flatMap(d =>
        (coverage[d.id]?.gaps ?? []).map(gap => ({
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'LineString' as const, coordinates: gap.coordinates },
        })),
      ),
    }),
    [visible, coverage],
  )

  const selectedView = medicViews.find(v => v.medic.id === selectedMedicId) ?? null

  const selectedRoute = useMemo(() => {
    if (!selectedView || selectedView.routePoints.length < 2) return null
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: selectedView.routePoints.map(p => [p.lng, p.lat] as [number, number]),
      },
    }
  }, [selectedView])

  const activeTraces = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: medicViews
        .filter(v => v.position?.phase === 'moving' && (v.position?.path?.length ?? 0) > 1)
        .map(v => ({
          type: 'Feature' as const,
          properties: { color: v.medic.color },
          geometry: { type: 'LineString' as const, coordinates: v.position!.path! },
        })),
    }),
    [medicViews],
  )

  const handleMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (!selectedMedicId) return
      onPlaceStation(selectedMedicId, [e.lngLat.lng, e.lngLat.lat])
    },
    [selectedMedicId, onPlaceStation],
  )

  return (
    <MapGL
      ref={mapRef}
      initialViewState={{ longitude: center[0], latitude: center[1], zoom: 11 }}
      mapStyle={styleFor(baseLayer, false)}
      style={{ width: '100%', height: '100%' }}
      cursor={selectedMedicId ? 'crosshair' : 'grab'}
      onLoad={() => applyBounds(pendingBounds.current ?? fitBounds)}
      onClick={handleMapClick}
      attributionControl={false}
    >
      <NavigationControl position="top-right" showCompass={false} />

      {/* ── Courses ─────────────────────────────────────────────────────── */}
      {trackData.map(track => (
        <Source key={track.id} id={`course-${track.id}`} type="geojson" data={track.geojson} lineMetrics>
          {/* A dark casing first: over a satellite tile or a pale topo map a
              bare coloured line disappears, and this is the one thing on the
              screen that always has to be findable. */}
          <Layer
            id={`course-casing-${track.id}`}
            source={`course-${track.id}`}
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': '#020617', 'line-width': 9, 'line-opacity': 0.55, 'line-blur': 0.5 }}
          />
          {/* The route itself. In gaps mode the gradient below paints over it. */}
          <Layer
            id={`course-base-${track.id}`}
            source={`course-${track.id}`}
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': track.reachMode ? '#64748b' : track.color,
              'line-width': 4.5,
              'line-opacity': track.hasSeries ? 0.45 : 0.9,
            }}
          />
          {/* Glow underneath makes a dense pack — or a long gap — read from a
              zoomed-out view. Siblings rather than a wrapped pair on purpose:
              react-map-gl injects the parent source onto each direct child, and
              a Fragment in between swallows it. */}
          {track.hasSeries && (showDensity || track.reachMode) && (
            <Layer
              id={`course-glow-${track.id}`}
              source={`course-${track.id}`}
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-gradient': track.gradient as never,
                'line-width': 20,
                'line-blur': 14,
                'line-opacity': 0.6,
              }}
            />
          )}
          {track.hasSeries && (showDensity || track.reachMode) && (
            <Layer
              id={`course-field-${track.id}`}
              source={`course-${track.id}`}
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-gradient': track.gradient as never, 'line-width': 6 }}
            />
          )}
        </Source>
      ))}

      {/* ── Individual runners ──────────────────────────────────────────── */}
      {runnerDots && (
        <Source id="planner-runners" type="geojson" data={runnerDots}>
          <Layer
            id="planner-runner-dots"
            source="planner-runners"
            type="circle"
            paint={{
              'circle-radius': 2.6,
              'circle-color': '#ffffff',
              'circle-opacity': 0.75,
              'circle-stroke-width': 1,
              'circle-stroke-color': ['get', 'color'],
              'circle-stroke-opacity': 0.9,
            }}
          />
        </Source>
      )}

      {/* ── Coverage gaps ───────────────────────────────────────────────── */}
      {/* The gradient already says red; this halo is what makes a long gap
          findable when the whole event is zoomed to fit. */}
      {coverageGaps.features.length > 0 && (
        <Source id="planner-gaps" type="geojson" data={coverageGaps}>
          <Layer
            id="planner-gap-glow"
            source="planner-gaps"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': '#ef4444', 'line-width': 30, 'line-opacity': 0.22, 'line-blur': 18 }}
          />
        </Source>
      )}

      {/* ── Selected medic's whole route ────────────────────────────────── */}
      {selectedRoute && selectedView && (
        <Source id="planner-medic-route" type="geojson" data={selectedRoute}>
          <Layer
            id="planner-medic-route-line"
            source="planner-medic-route"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': selectedView.medic.color,
              'line-width': 2,
              'line-opacity': 0.7,
              'line-dasharray': [1, 2],
            }}
          />
        </Source>
      )}

      {/* ── Live move traces ────────────────────────────────────────────── */}
      {activeTraces.features.length > 0 && (
        <Source id="planner-traces" type="geojson" data={activeTraces}>
          <Layer
            id="planner-trace-line"
            source="planner-traces"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.85 }}
          />
        </Source>
      )}

      {/* ── Points of interest ──────────────────────────────────────────── */}
      {pois.map(poi => {
        const config = POI_CONFIGS.find(c => c.type === poi.type)
        const snapping = dragSnapId === poi.id
        const armed = selectedMedicId !== null
        return (
          <Marker key={poi.id} longitude={poi.coordinates[0]} latitude={poi.coordinates[1]} anchor="center">
            {/* A marker sits above the canvas, so a click on it never reaches
                the map's own handler — and posting a medic ON a point is the
                single most common thing a planner does. Hence its own click. */}
            <div
              className="relative flex items-center justify-center"
              style={{ cursor: armed ? 'crosshair' : 'default' }}
              title={armed ? `Post here — ${poi.name ?? config?.label ?? 'point'}` : poi.name}
              onClick={event => {
                if (!selectedMedicId) return
                event.stopPropagation()
                onPlaceStation(selectedMedicId, poi.coordinates)
              }}
            >
              {snapping && (
                <span
                  className="absolute rounded-full"
                  style={{
                    width: 54,
                    height: 54,
                    border: '2px solid rgba(56,189,248,0.9)',
                    background: 'rgba(56,189,248,0.14)',
                    animation: 'plannerSnapPulse 1s ease-out infinite',
                  }}
                />
              )}
              <span
                className="flex items-center justify-center rounded-lg transition-transform"
                style={{
                  width: snapping ? 30 : 24,
                  height: snapping ? 30 : 24,
                  background: config?.bg ?? '#1e293b',
                  border: `1.5px solid ${config?.color ?? '#94a3b8'}`,
                  boxShadow: snapping ? '0 0 18px rgba(56,189,248,0.7)' : '0 2px 8px rgba(0,0,0,0.5)',
                }}
              >
                <PoiIcon type={poi.type} icon={poi.icon} size={14} color={config?.color ?? '#94a3b8'} />
              </span>
            </div>
          </Marker>
        )
      })}

      {/* ── Field edges ─────────────────────────────────────────────────── */}
      {edgeMarkers.map(edge => (
        <Marker key={edge.key} longitude={edge.lngLat[0]} latitude={edge.lngLat[1]} anchor="center">
          <div
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap"
            style={{
              background: 'rgba(2,8,18,0.82)',
              border: `1px solid ${edge.color}`,
              color: edge.color,
              transform: 'translateY(-14px)',
            }}
          >
            {edge.kind === 'leader' ? '▲' : '▼'} {edge.label}
          </div>
        </Marker>
      ))}

      {/* ── Station pins for the selected medic ─────────────────────────── */}
      {selectedView?.routePoints.map((point, i) => (
        <Marker key={point.id} longitude={point.lng} latitude={point.lat} anchor="center">
          <div
            className="flex items-center justify-center rounded-full text-[10px] font-black"
            style={{
              width: 18,
              height: 18,
              background: 'rgba(2,8,18,0.9)',
              border: `1.5px solid ${selectedView.medic.color}`,
              color: selectedView.medic.color,
            }}
            title={point.label}
          >
            {i + 1}
          </div>
        </Marker>
      ))}

      {/* ── Medic pucks ─────────────────────────────────────────────────── */}
      {medicViews.map(view => {
        if (!view.position || view.medic.hidden) return null
        const selected = view.medic.id === selectedMedicId
        const hovered = hoverMedicId === view.medic.id
        const offDuty = view.position.phase === 'off-duty'
        const moving = view.position.phase === 'moving'
        const sweeping = view.position.phase === 'sweeping'
        const meta = VEHICLE_TYPE_META[view.vehicleType] ?? VEHICLE_TYPE_META.foot
        const sweepColor = (view.position.disciplineId && sweepColors[view.position.disciplineId]) || view.medic.color
        return (
          <Marker
            key={view.medic.id}
            longitude={view.position.position[0]}
            latitude={view.position.position[1]}
            anchor="center"
            draggable={!sweeping}
            onDragStart={() => onSelectMedic(view.medic.id)}
            onDrag={e => {
              const snap = snapTarget([e.lngLat.lng, e.lngLat.lat])
              setDragSnapId(snap?.id ?? null)
            }}
            onDragEnd={e => {
              setDragSnapId(null)
              onDragStation(view.medic.id, [e.lngLat.lng, e.lngLat.lat])
            }}
          >
            <div
              className="relative flex items-center justify-center"
              onMouseEnter={() => setHoverMedicId(view.medic.id)}
              onMouseLeave={() => setHoverMedicId(null)}
              onClick={event => {
                event.stopPropagation()
                onSelectMedic(selected ? null : view.medic.id)
              }}
              style={{ cursor: 'grab' }}
            >
              {(moving || sweeping) && (
                <span
                  className="absolute rounded-full"
                  style={{
                    width: 44,
                    height: 44,
                    border: `1.5px solid ${sweeping ? sweepColor : view.medic.color}`,
                    animation: `plannerMovePulse ${sweeping ? '2.4s' : '1.6s'} ease-out infinite`,
                  }}
                />
              )}
              {/* A sweeper is pinned to the back of a field, so it carries that
                  discipline's colour as a ring — you can see at a glance which
                  race's tail it is riding. */}
              {sweeping && (
                <span
                  className="absolute rounded-full"
                  style={{ width: 34, height: 34, border: `2px dashed ${sweepColor}`, opacity: 0.9 }}
                />
              )}
              <span
                className="flex items-center justify-center rounded-full text-[13px] transition-all"
                style={{
                  width: selected ? 38 : 30,
                  height: selected ? 38 : 30,
                  background: offDuty ? 'rgba(15,23,42,0.75)' : 'rgba(2,8,18,0.94)',
                  border: `${selected ? 2.5 : 2}px ${offDuty ? 'dashed' : 'solid'} ${view.medic.color}`,
                  boxShadow: selected
                    ? `0 0 0 4px ${view.medic.color}22, 0 6px 18px rgba(0,0,0,0.6)`
                    : '0 3px 10px rgba(0,0,0,0.5)',
                  opacity: offDuty ? 0.5 : 1,
                }}
              >
                {meta.icon}
              </span>
              {(selected || hovered) && (
                <div
                  className="absolute whitespace-nowrap px-2 py-1 rounded-lg text-[10px] font-bold pointer-events-none"
                  style={{
                    top: selected ? 42 : 34,
                    background: 'rgba(2,8,18,0.92)',
                    border: `1px solid ${view.medic.color}55`,
                    color: '#e2e8f0',
                  }}
                >
                  {view.medic.name}
                  <span style={{ color: view.medic.color }}>
                    {' · '}
                    {view.position.phase === 'moving'
                      ? `→ ${view.position.label}`
                      : view.position.phase === 'sweeping'
                        ? `sweeping ${view.position.label}`
                        : view.position.phase === 'off-duty'
                          ? 'off duty'
                          : view.position.label}
                  </span>
                </div>
              )}
            </div>
          </Marker>
        )
      })}
    </MapGL>
  )
}
