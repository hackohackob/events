'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapGL, { Layer, Marker, NavigationControl, Source } from 'react-map-gl/maplibre'
import type { MapLayerMouseEvent, MapRef } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { VEHICLE_TYPE_META } from '@events/contracts'
import type { PlanMedic, TrackAccessTier, VehicleType } from '@events/contracts'
import { TRACK_ACCESS_COLORS } from '@/lib/track-access'
import {
  isStreets3dReady,
  loadStreets3dStyle,
  styleFor,
  TERRAIN_PITCH,
  type BaseLayer,
} from '@/lib/map-styles'
import { PoiIcon } from '@/lib/poi-icons'
import { POI_CONFIGS } from '@/lib/constants'
import type { PointOfInterest } from '@/lib/types'
import { DENSITY_BINS, type FieldState } from '@events/planner'
import type { PlannerDiscipline } from '@/hooks/usePlanner'
import type { CoverageReport } from '@events/planner'
import type { MedicPosition } from '@events/planner'

export interface PlannedMedicView {
  medic: PlanMedic
  /** The vehicle this medic is on at the playhead, not their base vehicle. */
  vehicleType: VehicleType
  position: MedicPosition | null
  /** The whole day's route, in order — drawn when the medic is selected. */
  routePoints: Array<{ id: string; lng: number; lat: number; label: string; arriveMs: number }>
  /**
   * Each journey as it will actually be driven, for the selected medic: the
   * routed geometry plus any waypoints it has been bent through.
   */
  legs: Array<{
    stationId: string
    via: Array<{ lat: number; lng: number }>
    /** The drawn line cut at its waypoints; each piece knows the order slot a
     *  new waypoint grabbed there should take. */
    segments: Array<{ path: [number, number][]; insertAt: number }>
  }>
}

interface Props {
  center: [number, number]
  baseLayer: BaseLayer
  /** DEM terrain + a tilted camera, independent of the base layer. */
  enable3d: boolean
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
  /** The drawn route was grabbed — bend this leg through here, at this slot. */
  onAddVia: (
    medicId: string,
    stationId: string,
    lngLat: [number, number],
    insertAt: number,
  ) => void
  onMoveVia: (medicId: string, stationId: string, index: number, lngLat: [number, number]) => void
  onRemoveVia: (medicId: string, stationId: string, index: number) => void
  /** A puck was dragged — relocates the posting the medic is currently on. */
  onDragStation: (medicId: string, lngLat: [number, number]) => void
  /** Nearest POI within snapping range of a coordinate, if any. */
  snapTarget: (lngLat: [number, number]) => PointOfInterest | null
  fitBounds?: [[number, number], [number, number]]
  showRunners: boolean
  showDensity: boolean
  /** Per discipline: what can drive each course bin. Only in access mode. */
  access: Record<string, TrackAccessTier[] | undefined>
  accessMode: boolean
  /** Reach analysis per discipline; drives the course colouring in gaps mode. */
  coverage: Record<string, CoverageReport>
  /** Only for the legend wording; the ratios already carry the maths. */
  reachMinutes: number
  /** Sweep windows, so a sweeping medic's puck reads differently. */
  sweepColors: Record<string, string>
}

/** "Nurse Elena D." → "NE". Two letters is what fits legibly at puck size. */
function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N} .'-]/gu, '')
    .split(/[\s.]+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
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
 * discipline's own hue, throughout.
 *
 * It used to burn towards a hot amber white as the field bunched up, which
 * meant the one moment you most want to read at a glance — the gun, with the
 * whole field still packed on the first kilometre — painted every course the
 * same white, and the colours only appeared once the field had spread out.
 * Density now speaks through weight instead: the hue holds, and a busy stretch
 * comes up in opacity (and in the glow beneath it). Lightening is capped at a
 * sliver, just enough to keep a packed stretch from reading as a flat block.
 */
function densityColor(hex: string, density: number, forGlow = false): string {
  const base = hexToRgb(hex)
  // Empty course paints NOTHING, here as in the glow. Courses are drawn one
  // after another, so a stretch one course has nobody on would otherwise lay
  // its idle wash straight over a neighbouring course's live colour — which is
  // why shared sections, and the out-and-back of a single loop, went muddy. The
  // route itself is already drawn by the casing and base beneath.
  if (density <= 0.002) return TRANSPARENT
  const heat = Math.min(1, density * 1.45)
  const lift: [number, number, number] = [255, 255, 255]
  return rgba(mix(base, lift, 0.12 * Math.pow(heat, 1.6)), 0.55 + 0.45 * Math.min(1, density * 2.2))
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

/**
 * The resting colour of a course in field mode: slate, carrying just enough of
 * the discipline's hue to tell two courses apart where they run side by side.
 * The line itself is scenery — what the eye is meant to catch is the field on
 * it, so the colour that means "people" belongs to the density gradient and the
 * runner dots, not to the road under them.
 */
function idleCourseColor(hex: string): string {
  return rgba(mix(IDLE_COURSE, hexToRgb(hex), 0.22), 1)
}

const TRANSPARENT = 'rgba(0,0,0,0)'

/**
 * Only stretches carrying people are painted at all — in the line as well as in
 * the glow. Courses are drawn one after another, so an idle wash from whichever
 * course happens to be drawn last would sit over a live one beneath it, and
 * every shared section would read as muted. Where nobody is on the course the
 * neutral line underneath shows through instead, which says the same thing
 * without taking a colour away from anyone.
 */
function reachColor(ratio: number, occupied: boolean, _forGlow = false): string {
  if (!occupied) return TRANSPARENT
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

/**
 * Colour for a stretch by what can drive it.
 *
 * Flat, unshaded colour on purpose: this is a property of the ground, not a
 * measurement that varies in strength, and grading it by opacity the way the
 * field and reach ramps do would read as confidence we do not have. A stretch
 * with no mapped way is painted with nothing at all, so the neutral course line
 * shows through — the one honest way to draw "we have no information here".
 */
function accessColor(tier: TrackAccessTier | undefined): string {
  const hex = tier ? TRACK_ACCESS_COLORS[tier] : null
  return hex ? rgba(hexToRgb(hex), 0.96) : TRANSPARENT
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
  enable3d,
  disciplines,
  fields,
  hiddenDisciplineIds,
  pois,
  medicViews,
  selectedMedicId,
  onSelectMedic,
  onPlaceStation,
  onAddVia,
  onMoveVia,
  onRemoveVia,
  onDragStation,
  snapTarget,
  fitBounds,
  showRunners,
  showDensity,
  access,
  accessMode,
  coverage,
  sweepColors,
}: Props) {
  const mapRef = useRef<MapRef>(null)
  const [dragSnapId, setDragSnapId] = useState<string | null>(null)
  /** A waypoint being pulled out of the drawn route, before it is committed. */
  const [viaDrag, setViaDrag] = useState<
    { medicId: string; stationId: string; insertAt: number; lngLat: [number, number] } | null
  >(null)
  /** The drag ends in a click; that click must not also post a station. */
  const suppressClick = useRef(false)
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

  // Tilt into the 3D view and flatten back out. Without the pitch the terrain
  // is there but invisible — looking straight down at relief shows nothing.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.easeTo({ pitch: enable3d ? TERRAIN_PITCH : 0, duration: 800 })
  }, [enable3d])

  // Streets 3D is a remote vector style that has to be fetched and merged with
  // the DEM; the bump re-renders once it is cached so styleFor picks it up.
  const [, bumpStreets3d] = useState(0)
  useEffect(() => {
    if (!enable3d || baseLayer !== 'streets' || isStreets3dReady()) return
    let alive = true
    void loadStreets3dStyle().then(() => {
      if (alive) bumpStreets3d(n => n + 1)
    })
    return () => {
      alive = false
    }
  }, [enable3d, baseLayer])

  // Leaving a 3D style lags the toggle by one commit: the terrain has to be
  // torn down first (setTerrain is synchronous), or maplibre's terrain depth
  // pass renders against a half-replaced style and throws in shaderPreludeCode.
  const [applied, setApplied] = useState({ base: baseLayer, is3d: enable3d })
  useEffect(() => {
    if (applied.base === baseLayer && applied.is3d === enable3d) return
    if (applied.is3d) {
      try {
        const map = mapRef.current?.getMap()
        if (map?.getTerrain()) map.setTerrain(null)
      } catch {
        /* style mid-load — swapping it out is safe anyway */
      }
    }
    setApplied({ base: baseLayer, is3d: enable3d })
  }, [baseLayer, enable3d, applied])

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
        const reachMode = report != null && report.ratio.length > 0
        const tiers = accessMode ? access[d.id] : undefined
        const accessPainted = Boolean(tiers && tiers.length > 0)
        return {
          id: d.id,
          color: d.color,
          reachMode,
          accessPainted,
          geojson: {
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'LineString' as const, coordinates: d.course.coordinates },
          },
          gradient: accessPainted
            ? gradientExpression(bin => accessColor(tiers![Math.min(tiers!.length - 1, bin)]))
            : reachMode
              ? gradientExpression(bin =>
                  reachColor(report.ratio[bin] ?? Number.POSITIVE_INFINITY, report.occupied[bin] ?? false),
                )
              : gradientExpression(bin => densityColor(d.color, density[bin] ?? 0)),
          glowGradient: reachMode
            ? gradientExpression(bin =>
                reachColor(report.ratio[bin] ?? Number.POSITIVE_INFINITY, report.occupied[bin] ?? false, true),
              )
            : gradientExpression(bin => densityColor(d.color, density[bin] ?? 0, true)),
          hasSeries: accessPainted || reachMode || density.length > 0,
        }
      }),
    [visible, fields, coverage, access, accessMode],
  )

  /** Gaps mode owns the colour of everything; field mode hands it back. */
  const reachActive = useMemo(
    () => accessMode || trackData.some(t => t.reachMode),
    [trackData, accessMode],
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

  // One feature per leg, carrying the station it arrives at, so a click on the
  // drawn route knows which journey it landed on.
  // One feature per PIECE of each leg — the stretches between waypoints — so a
  // grab on the drawn line knows both which journey and where in its order.
  const selectedRoute = useMemo(() => {
    if (!selectedView || selectedView.legs.length === 0) return null
    return {
      type: 'FeatureCollection' as const,
      features: selectedView.legs.flatMap(leg =>
        leg.segments.map(segment => ({
          type: 'Feature' as const,
          properties: { stationId: leg.stationId, insertAt: segment.insertAt },
          geometry: { type: 'LineString' as const, coordinates: segment.path },
        })),
      ),
    }
  }, [selectedView])

  /**
   * Take hold of the drawn route.
   *
   * Dragging the line is the gesture every mapping tool has taught people, so
   * it has to be the one that works — a click alone left you panning the map
   * and wondering where the waypoint went. The map's own pan is suspended for
   * the duration, the waypoint follows the pointer, and it commits on release.
   *
   * Hit-tested against the map directly rather than through
   * `interactiveLayerIds`: a layer that only appears alongside a selection did
   * not qualify there, and the gesture fell straight through to the map.
   */
  const handleMapMouseDown = useCallback(
    (e: MapLayerMouseEvent) => {
      if (!selectedMedicId) return
      const map = mapRef.current?.getMap()
      const hits =
        map?.queryRenderedFeatures([e.point.x, e.point.y], {
          layers: ['planner-medic-route-grab'],
        }) ?? []
      const stationId = hits[0]?.properties?.stationId
      if (typeof stationId !== 'string') return
      const insertAt = Number(hits[0]?.properties?.insertAt)

      e.preventDefault()
      map?.dragPan.disable()
      suppressClick.current = true
      setViaDrag({
        medicId: selectedMedicId,
        stationId,
        insertAt: Number.isFinite(insertAt) ? insertAt : 0,
        lngLat: [e.lngLat.lng, e.lngLat.lat],
      })
    },
    [selectedMedicId],
  )

  const handleMapMouseMove = useCallback(
    (e: MapLayerMouseEvent) => {
      if (!viaDrag) return
      setViaDrag({ ...viaDrag, lngLat: [e.lngLat.lng, e.lngLat.lat] })
    },
    [viaDrag],
  )

  const handleMapMouseUp = useCallback(() => {
    if (!viaDrag) return
    mapRef.current?.getMap()?.dragPan.enable()
    onAddVia(viaDrag.medicId, viaDrag.stationId, viaDrag.lngLat, viaDrag.insertAt)
    setViaDrag(null)
  }, [viaDrag, onAddVia])

  const handleMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (!selectedMedicId) return
      if (suppressClick.current) {
        suppressClick.current = false
        return
      }
      onPlaceStation(selectedMedicId, [e.lngLat.lng, e.lngLat.lat])
    },
    [selectedMedicId, onPlaceStation],
  )

  return (
    <MapGL
      ref={mapRef}
      initialViewState={{ longitude: center[0], latitude: center[1], zoom: 11 }}
      mapStyle={styleFor(applied.base, applied.is3d)}
      style={{ width: '100%', height: '100%' }}
      cursor={viaDrag ? 'grabbing' : selectedMedicId ? 'crosshair' : 'grab'}
      onLoad={() => applyBounds(pendingBounds.current ?? fitBounds)}
      onClick={handleMapClick}
      onMouseDown={handleMapMouseDown}
      onMouseMove={handleMapMouseMove}
      onMouseUp={handleMapMouseUp}
      attributionControl={false}
    >
      <NavigationControl position="top-right" showCompass={enable3d} visualizePitch={enable3d} />

      {/* ── Courses ─────────────────────────────────────────────────────── */}
      {/* Grouped by ROLE, not by course. MapLibre draws layers in the order
          they are added, so a per-course block would put the second course's
          dark casing and slate under-line straight over the first course's
          gradient — which is exactly what happens where two courses share a
          valley: one route reads and its neighbours go muddy. Every casing
          goes down first, then every under-line, then every gradient. */}
      {trackData.map(track => (
        <Source key={track.id} id={`course-${track.id}`} type="geojson" data={track.geojson} lineMetrics />
      ))}

      {/* A dark casing: over a satellite tile or a pale topo map a bare
          coloured line disappears, and this is the one thing on the screen that
          always has to be findable. */}
      {trackData.map(track => (
        <Layer
          key={`casing-${track.id}`}
          id={`course-casing-${track.id}`}
          source={`course-${track.id}`}
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': '#020617', 'line-width': 9, 'line-opacity': 0.55, 'line-blur': 0.5 }}
        />
      ))}

      {/* The route itself; the gradient paints over it where there is one. */}
      {trackData.map(track => (
        <Layer
          key={`base-${track.id}`}
          id={`course-base-${track.id}`}
          source={`course-${track.id}`}
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color':
              track.reachMode || accessMode ? '#7c8ba1' : idleCourseColor(track.color),
            // Carries the idle stretches on its own now, so it has to read as a
            // route in its own right — same weight the gradient line has, or an
            // empty course looks like a thinner, lesser thing than a busy one.
            'line-width': 6,
            'line-opacity': track.hasSeries ? 0.72 : 0.9,
          }}
        />
      ))}

      {/* Glow makes a dense pack — or a long gap — read from a zoomed-out view. */}
      {trackData.map(track =>
        track.hasSeries && !accessMode && (showDensity || track.reachMode) ? (
          <Layer
            key={`glow-${track.id}`}
            id={`course-glow-${track.id}`}
            source={`course-${track.id}`}
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-gradient': track.glowGradient as never,
              'line-width': 16,
              'line-blur': 12,
              'line-opacity': 0.55,
            }}
          />
        ) : null,
      )}

      {trackData.map(track =>
        track.hasSeries && (showDensity || track.reachMode || track.accessPainted) ? (
          <Layer
            key={`field-${track.id}`}
            id={`course-field-${track.id}`}
            source={`course-${track.id}`}
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-gradient': track.gradient as never, 'line-width': 6 }}
          />
        ) : null,
      )}

      {/* ── Individual runners ──────────────────────────────────────────── */}
      {runnerDots && (
        <Source id="planner-runners" type="geojson" data={runnerDots}>
          {/* Deliberately tiny and unstroked: at the gun the whole field sits
              in a few hundred metres, and fat dots there paint over the very
              gradient they are meant to annotate.

              In field mode each dot wears its own course's colour — that is
              what tells you whose runners these are on a shared stretch. In
              gaps mode colour is spoken for by reach, so they go back to a
              neutral white that cannot be mistaken for a reading. */}
          <Layer
            id="planner-runner-dots"
            source="planner-runners"
            type="circle"
            paint={{
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1.1, 12, 1.6, 16, 2.4],
              'circle-color': reachActive ? '#ffffff' : (['get', 'color'] as never),
              'circle-opacity': reachActive ? 0.8 : 0.95,
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
          {/* A wide, invisible line makes the route easy to grab; the visible
              one stays thin. */}
          <Layer
            id="planner-medic-route-grab"
            source="planner-medic-route"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': selectedView.medic.color, 'line-width': 18, 'line-opacity': 0.01 }}
          />
          <Layer
            id="planner-medic-route-line"
            source="planner-medic-route"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': selectedView.medic.color,
              'line-width': 2.5,
              'line-opacity': 0.85,
              'line-dasharray': [2, 1.5],
            }}
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

      {/* ── Waypoints on the selected medic's route ─────────────────────── */}
      {/* The waypoint being dragged out of the route, before release. */}
      {viaDrag && selectedView && (
        <Marker longitude={viaDrag.lngLat[0]} latitude={viaDrag.lngLat[1]} anchor="center">
          <div
            className="rounded-full"
            style={{
              width: 15,
              height: 15,
              background: selectedView.medic.color,
              border: '2px solid #0f172a',
              boxShadow: `0 0 0 4px ${selectedView.medic.color}33`,
            }}
          />
        </Marker>
      )}

      {selectedView?.legs.flatMap(leg =>
        leg.via.map((point, index) => (
          <Marker
            key={`${leg.stationId}-via-${index}`}
            longitude={point.lng}
            latitude={point.lat}
            anchor="center"
            draggable
            onDragEnd={e =>
              onMoveVia(selectedView.medic.id, leg.stationId, index, [e.lngLat.lng, e.lngLat.lat])
            }
          >
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: 13,
                height: 13,
                background: '#0f172a',
                border: `2px solid ${selectedView.medic.color}`,
                cursor: 'grab',
                boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
              }}
              title="Drag to move this waypoint · click to drop it"
              onClick={event => {
                event.stopPropagation()
                onRemoveVia(selectedView.medic.id, leg.stationId, index)
              }}
            />
          </Marker>
        )),
      )}

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
              {/* Initials, not a vehicle glyph: on a board with a dozen units
                  the question is always "who is that", and every second one
                  was the same ambulance emoji. The vehicle rides along as a
                  corner chip, because it still sets the travel times. */}
              <span
                className="relative flex items-center justify-center rounded-full transition-all"
                style={{
                  width: selected ? 38 : 30,
                  height: selected ? 38 : 30,
                  background: offDuty ? 'rgba(15,23,42,0.75)' : 'rgba(2,8,18,0.94)',
                  border: `${selected ? 2.5 : 2}px ${offDuty ? 'dashed' : 'solid'} ${view.medic.color}`,
                  boxShadow: selected
                    ? `0 0 0 4px ${view.medic.color}22, 0 6px 18px rgba(0,0,0,0.6)`
                    : '0 3px 10px rgba(0,0,0,0.5)',
                  opacity: offDuty ? 0.5 : 1,
                  color: view.medic.color,
                  fontSize: selected ? 13 : 11,
                  fontWeight: 800,
                  letterSpacing: '0.02em',
                }}
              >
                {initials(view.medic.name)}
                <span
                  className="absolute flex items-center justify-center rounded-full"
                  style={{
                    right: -3,
                    bottom: -3,
                    width: 14,
                    height: 14,
                    fontSize: 8,
                    background: 'rgba(2,8,18,0.96)',
                    border: `1px solid ${view.medic.color}66`,
                  }}
                  title={meta.label}
                >
                  {meta.icon}
                </span>
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
