'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Layer, Marker, Popup, Source, useMap } from 'react-map-gl/maplibre'
import type { MapLayerMouseEvent, MapLayerTouchEvent } from 'react-map-gl/maplibre'
import { EyeOff } from 'lucide-react'
import type { EventDrawing, UpdateDrawingRequest } from '@events/contracts'
import type { DrawingDraft } from '@/hooks/useDrawingDraft'
import {
  boundsOf,
  formatDistance,
  longestLine,
  metersBetween,
  midpointAlong,
  screenLength,
  smoothStroke,
  type LngLat,
  type Px,
} from '@/lib/drawing-geometry'
import DrawingCard from './DrawingCard'

/** Dark outline under every drawn line, so it reads on streets, satellite and terrain alike. */
const CASING = '#0b1220'
/** How close (px) a click/stroke must start to the end of a line to pick it up. */
const PICK_UP_PX = 14
const HIT_LAYER = 'drawings-hit'

const width = (base: number) =>
  ['interpolate', ['linear'], ['zoom'], 9, base * 0.55, 13, base, 17, base * 1.4] as unknown as number

export interface DrawingLayersProps {
  /** Every drawing to show — hidden-from-team ones included (drawn faded). */
  drawings: EventDrawing[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onUpdate: (id: string, patch: UpdateDrawingRequest) => void
  onDelete: (drawing: EventDrawing) => void
  /** The drawing in progress, if the tool is open. */
  draft?: DrawingDraft
  /** Colour/dash the draft is shown in — the save card previews its choice live. */
  draftStyle?: { color: string; dashed: boolean }
  /** Frame a drawing; the nonce re-triggers the flight for the same one. */
  focus?: { id: string; nonce: number } | null
  zoom: number
  /** Changes when other line layers (tracks) are re-added, so these stay on top. */
  stackKey?: string
}

export default function DrawingLayers({
  drawings,
  selectedId,
  onSelect,
  onUpdate,
  onDelete,
  draft,
  draftStyle = { color: '#f97316', dashed: false },
  focus,
  zoom,
  stackKey = '',
}: DrawingLayersProps) {
  const { current: mapRef } = useMap()
  const drawingNow = draft != null && draft.phase !== 'idle'

  // ── Saved drawings ─────────────────────────────────────────────────────────
  const collection = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: drawings.map(drawing => ({
      type: 'Feature' as const,
      properties: {
        id: drawing.id,
        color: drawing.color,
        dashed: drawing.dashed,
        dim: !drawing.visible,
        selected: drawing.id === selectedId,
      },
      geometry: { type: 'MultiLineString' as const, coordinates: drawing.lines },
    })),
  }), [drawings, selectedId])

  const labels = useMemo(() => drawings.map(drawing => ({
    drawing,
    at: midpointAlong(longestLine(drawing.lines as LngLat[][])),
  })), [drawings])

  const selected = drawings.find(d => d.id === selectedId) ?? null
  // Where the card opens. A line picked by clicking it gets the card AT the
  // click — its midpoint may be kilometres off-screen. Anything else (label,
  // list row) uses the midpoint, which the map is then framed on.
  const [clickAnchor, setClickAnchor] = useState<{ id: string; at: LngLat } | null>(null)
  const selectedAt = clickAnchor?.id === selectedId
    ? clickAnchor.at
    : labels.find(l => l.drawing.id === selectedId)?.at

  // Clicking a line selects it; clicking empty map lets go. Off while the tool
  // is open — clicks belong to the drawing then.
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map || drawingNow) return
    const hitAt = (point: { x: number; y: number }) => {
      if (!map.getLayer(HIT_LAYER)) return null
      const hits = map.queryRenderedFeatures(
        [[point.x - 5, point.y - 5], [point.x + 5, point.y + 5]],
        { layers: [HIT_LAYER] },
      )
      return (hits[0]?.properties?.id as string | undefined) ?? null
    }
    const onClick = (e: MapLayerMouseEvent) => {
      // Markers sit inside the map's event container, so their clicks arrive
      // here too — those are not clicks on the map.
      const target = e.originalEvent.target as Element | null
      if (target?.closest?.('.maplibregl-marker')) return
      const id = hitAt(e.point)
      setClickAnchor(id ? { id, at: [e.lngLat.lng, e.lngLat.lat] } : null)
      onSelectRef.current(id)
    }
    // The cursor is switched with a class, not the canvas's inline style:
    // react-map-gl owns that style and only rewrites it when its `cursor` prop
    // changes, so clearing it here would leave the map without its grab hand.
    const container = map.getContainer()
    const onMove = (e: MapLayerMouseEvent) => {
      container.classList.toggle('drawing-hover', hitAt(e.point) != null)
    }
    map.on('click', onClick)
    map.on('mousemove', onMove)
    return () => {
      map.off('click', onClick)
      map.off('mousemove', onMove)
      container.classList.remove('drawing-hover')
    }
  }, [mapRef, drawingNow])

  // Frame a drawing on request (list row, "zoom to" on the card).
  useEffect(() => {
    if (!focus || !mapRef) return
    setClickAnchor(null)
    const target = drawings.find(d => d.id === focus.id)
    const bounds = target ? boundsOf(target.lines as LngLat[][]) : null
    if (!bounds) return
    const map = mapRef.getMap()
    mapRef.fitBounds(bounds, {
      padding: { top: 140, bottom: 120, left: 90, right: 260 },
      maxZoom: 16,
      duration: 700,
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce])

  return (
    <>
      <Source key={`drawings-${stackKey}`} id="drawings" type="geojson" data={collection}>
        {/* Soft glow under the selected drawing. */}
        <Layer
          id="drawings-halo"
          type="line"
          filter={['==', ['get', 'selected'], true]}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': ['get', 'color'], 'line-width': width(16), 'line-blur': 8, 'line-opacity': 0.5 }}
        />
        <Layer
          id="drawings-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': CASING,
            'line-width': width(7.5),
            'line-opacity': ['case', ['get', 'dim'], 0.25, 0.85],
          }}
        />
        <Layer
          id="drawings-solid"
          type="line"
          filter={['!=', ['get', 'dashed'], true]}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': ['get', 'color'],
            'line-width': width(4),
            'line-opacity': ['case', ['get', 'dim'], 0.4, 1],
          }}
        />
        {/* Dashed lines keep a faint continuous bed so the gaps never read as breaks. */}
        <Layer
          id="drawings-dashed-bed"
          type="line"
          filter={['==', ['get', 'dashed'], true]}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': ['get', 'color'],
            'line-width': width(4),
            'line-opacity': ['case', ['get', 'dim'], 0.12, 0.28],
          }}
        />
        <Layer
          id="drawings-dashed"
          type="line"
          filter={['==', ['get', 'dashed'], true]}
          layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
          paint={{
            'line-color': ['get', 'color'],
            'line-width': width(4),
            'line-dasharray': [1.7, 1.3],
            'line-opacity': ['case', ['get', 'dim'], 0.4, 1],
          }}
        />
        {/* A fat invisible line: something generous to click. */}
        <Layer
          id={HIT_LAYER}
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': '#000000', 'line-width': 18, 'line-opacity': 0.001 }}
        />
      </Source>

      {/* Name labels — only for drawings that have one, and not from far out. */}
      {!drawingNow && labels.map(({ drawing, at }) => {
        if (!drawing.name || drawing.id === selectedId || zoom < 10.5) return null
        return (
          <Marker
            key={`drawing-label-${drawing.id}`}
            longitude={at[0]}
            latitude={at[1]}
            onClick={(e) => {
              e.originalEvent.stopPropagation()
              setClickAnchor(null)
              onSelect(drawing.id)
            }}
          >
            <div
              className="flex items-center gap-1.5 pl-1.5 pr-2 py-[3px] rounded-full whitespace-nowrap cursor-pointer select-none"
              style={{
                background: 'rgba(8,15,28,0.9)',
                border: `1px solid ${drawing.color}73`,
                boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
                opacity: drawing.visible ? 1 : 0.6,
              }}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: drawing.color }} />
              <span className="text-[11px] font-bold" style={{ color: '#f1f5f9', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {drawing.name}
              </span>
              {drawing.snapped && (
                <span className="text-[10px] font-semibold tabular-nums" style={{ color: '#94a3b8' }}>
                  {formatDistance(drawing.distanceMeters)}
                </span>
              )}
              {!drawing.visible && <EyeOff className="w-3 h-3" style={{ color: '#94a3b8' }} />}
            </div>
          </Marker>
        )
      })}

      {/* The selected drawing's card. A Popup rather than a Marker: popups live
          outside the map's event container, so typing, dragging to select text
          and scrolling inside the card never pan or zoom the map. */}
      {!drawingNow && selected && selectedAt && (
        <Popup
          key={`${selected.id}-${clickAnchor?.id === selected.id ? 'click' : 'mid'}`}
          longitude={selectedAt[0]}
          latitude={selectedAt[1]}
          anchor="bottom"
          offset={14}
          closeButton={false}
          closeOnClick={false}
          // maplibre focuses the first field of a popup as it opens — before
          // it has been positioned. The browser then scrolls that field into
          // view, and what scrolls is the dashboard's own clipped layout: the
          // side panel and the map slide out of the window.
          focusAfterOpen={false}
          className="drawing-popup"
          maxWidth="320px"
          onClose={() => onSelect(null)}
        >
          <DrawingCard
            drawing={selected}
            onUpdate={(patch) => onUpdate(selected.id, patch)}
            onDelete={() => onDelete(selected)}
            onClose={() => onSelect(null)}
          />
        </Popup>
      )}

      {draft && drawingNow && <DraftLayers draft={draft} style={draftStyle} />}
    </>
  )
}

// ─── The drawing in progress ─────────────────────────────────────────────────

function DraftLayers({ draft, style }: { draft: DrawingDraft; style: { color: string; dashed: boolean } }) {
  const { current: mapRef } = useMap()
  /** Freehand stroke under the pointer right now (raw, unsmoothed). */
  const [stroke, setStroke] = useState<LngLat[]>([])
  /** Pointer position while clicking out a line, for the rubber band. */
  const [cursor, setCursor] = useState<LngLat | null>(null)
  /** Pointer is on the end of a line: the next click ends / picks it up. */
  const [onEnd, setOnEnd] = useState<'end' | 'pickup' | null>(null)

  // Handlers are registered once per tool; they read the newest draft from here.
  const draftRef = useRef(draft)
  draftRef.current = draft

  const interactive = draft.phase === 'drawing'
  const tool = draft.tool

  // While drawing, the map's own shortcuts would fight the tool.
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map || !interactive) return
    const container = map.getContainer()
    container.classList.add('drawing-active')
    map.doubleClickZoom.disable()
    return () => {
      container.classList.remove('drawing-active')
      map.doubleClickZoom.enable()
    }
  }, [mapRef, interactive])

  // ── Freehand: press, drag, release ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map || !interactive || tool !== 'freehand') return
    const project = (p: LngLat): Px => {
      const q = map.project(p)
      return [q.x, q.y]
    }
    let drawing = false
    let points: LngLat[] = []
    let frame = 0
    let spaceHeld = false

    map.dragPan.disable()

    const start = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      const original = e.originalEvent as MouseEvent & TouchEvent
      if (spaceHeld) return
      if (typeof original.button === 'number' && original.button !== 0) return
      // Two fingers are a pinch — leave them to the map.
      if (original.touches && original.touches.length > 1) {
        drawing = false
        points = []
        setStroke([])
        return
      }
      e.preventDefault()
      drawing = true
      points = [[e.lngLat.lng, e.lngLat.lat]]
      setStroke(points)
    }
    const move = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      if (!drawing) return
      points.push([e.lngLat.lng, e.lngLat.lat])
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setStroke(points.slice())
      })
    }
    const end = () => {
      if (!drawing) return
      drawing = false
      const raw = points
      points = []
      setStroke([])
      const px = raw.map(project)
      // A click or a twitch, not a stroke.
      if (screenLength(px) < 8) return
      const smooth = smoothStroke(raw, project)
      if (smooth.length < 2) return
      const lastEnd = draftRef.current.lastEnd
      const lastEndPx = lastEnd ? project(lastEnd) : null
      const continues = lastEndPx != null && Math.hypot(lastEndPx[0] - px[0][0], lastEndPx[1] - px[0][1]) <= PICK_UP_PX
      draftRef.current.addStroke(smooth, continues)
    }

    // Hold Space to pan without leaving the tool — the one thing a drag can't
    // do while it draws.
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    const keyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target) || spaceHeld) return
      e.preventDefault()
      spaceHeld = true
      map.dragPan.enable()
      map.getContainer().classList.add('drawing-pan')
    }
    const keyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !spaceHeld) return
      spaceHeld = false
      map.dragPan.disable()
      map.getContainer().classList.remove('drawing-pan')
    }

    map.on('mousedown', start)
    map.on('mousemove', move)
    map.on('touchstart', start)
    map.on('touchmove', move)
    map.on('touchend', end)
    map.on('touchcancel', end)
    // On the window: a stroke that ends outside the map still has to end.
    window.addEventListener('mouseup', end)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      map.off('mousedown', start)
      map.off('mousemove', move)
      map.off('touchstart', start)
      map.off('touchmove', move)
      map.off('touchend', end)
      map.off('touchcancel', end)
      window.removeEventListener('mouseup', end)
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      map.dragPan.enable()
      map.getContainer().classList.remove('drawing-pan')
      setStroke([])
    }
  }, [mapRef, interactive, tool])

  // ── Points: click, click, double-click ─────────────────────────────────────
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map || !interactive || tool !== 'points') return
    let frame = 0

    const near = (target: LngLat | null, point: { x: number; y: number }, within: number) => {
      if (!target) return false
      const q = map.project(target)
      return Math.hypot(q.x - point.x, q.y - point.y) <= within
    }
    const click = (e: MapLayerMouseEvent) => {
      const d = draftRef.current
      if (near(d.openEnd, e.point, 10)) {
        d.endPath()
        return
      }
      if (!d.openEnd && near(d.lastEnd, e.point, PICK_UP_PX)) {
        d.reopenLast()
        return
      }
      d.addPoint([e.lngLat.lng, e.lngLat.lat])
    }
    const doubleClick = (e: MapLayerMouseEvent) => {
      e.preventDefault()
      draftRef.current.endPath()
    }
    const move = (e: MapLayerMouseEvent) => {
      const at: LngLat = [e.lngLat.lng, e.lngLat.lat]
      const point = e.point
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const d = draftRef.current
        setCursor(at)
        setOnEnd(near(d.openEnd, point, 10) ? 'end' : !d.openEnd && near(d.lastEnd, point, PICK_UP_PX) ? 'pickup' : null)
      })
    }
    const leave = () => {
      setCursor(null)
      setOnEnd(null)
    }

    map.on('click', click)
    map.on('dblclick', doubleClick)
    map.on('mousemove', move)
    map.on('mouseout', leave)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      map.off('click', click)
      map.off('dblclick', doubleClick)
      map.off('mousemove', move)
      map.off('mouseout', leave)
      setCursor(null)
      setOnEnd(null)
    }
  }, [mapRef, interactive, tool])

  // ── Geometry to draw ───────────────────────────────────────────────────────
  const { settled, pending, vertices } = useMemo(() => {
    const settledFeatures: GeoJSON.Feature[] = []
    const pendingFeatures: GeoJSON.Feature[] = []
    const vertexFeatures: GeoJSON.Feature[] = []
    const dot = (at: LngLat, kind: 'joint' | 'end') => vertexFeatures.push({
      type: 'Feature', properties: { kind }, geometry: { type: 'Point', coordinates: at },
    })
    draft.paths.forEach((path, pathIndex) => {
      const isLastPath = pathIndex === draft.paths.length - 1
      if (path.segments.length === 0) {
        dot(path.start, 'end')
        return
      }
      path.segments.forEach((segment, index) => {
        const feature: GeoJSON.Feature = {
          type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: segment.coords },
        }
        ;(segment.pending ? pendingFeatures : settledFeatures).push(feature)
        const last = index === path.segments.length - 1
        // Joints only where they were placed by hand — a freehand stroke has none.
        if (segment.kind === 'leg' && !last) dot(segment.coords[segment.coords.length - 1], 'joint')
        if (last && isLastPath) dot(segment.coords[segment.coords.length - 1], 'end')
      })
    })
    const fc = (features: GeoJSON.Feature[]) => ({ type: 'FeatureCollection' as const, features })
    return { settled: fc(settledFeatures), pending: fc(pendingFeatures), vertices: fc(vertexFeatures) }
  }, [draft.paths])

  const band = interactive && tool === 'points' && draft.openEnd && cursor && !onEnd ? [draft.openEnd, cursor] : null
  const bandMeters = band ? metersBetween(band[0], band[1]) : 0
  const lineFeature = (coordinates: LngLat[]) => ({
    type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates },
  })

  return (
    <>
      <Source id="drawing-draft" type="geojson" data={settled}>
        <Layer
          id="drawing-draft-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': CASING, 'line-width': width(7.5), 'line-opacity': 0.85 }}
        />
        {style.dashed ? (
          <Layer
            key="dashed"
            id="drawing-draft-line"
            type="line"
            layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
            paint={{ 'line-color': style.color, 'line-width': width(4), 'line-dasharray': [1.7, 1.3] }}
          />
        ) : (
          <Layer
            key="solid"
            id="drawing-draft-line"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': style.color, 'line-width': width(4) }}
          />
        )}
      </Source>

      {/* Strokes still being matched to a road: shown as drawn, but tentative. */}
      <Source id="drawing-draft-pending" type="geojson" data={pending}>
        <Layer
          id="drawing-draft-pending-line"
          type="line"
          layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
          paint={{ 'line-color': style.color, 'line-width': width(3), 'line-opacity': 0.75, 'line-dasharray': [0.6, 1.4] }}
        />
      </Source>

      {/* The stroke under the pointer — raw, so it follows the hand exactly. */}
      <Source id="drawing-draft-stroke" type="geojson" data={lineFeature(stroke.length >= 2 ? stroke : [])}>
        <Layer
          id="drawing-draft-stroke-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': CASING, 'line-width': width(7.5), 'line-opacity': 0.6 }}
        />
        <Layer
          id="drawing-draft-stroke-line"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': style.color, 'line-width': width(4) }}
        />
      </Source>

      {/* Rubber band from the last point to the pointer. */}
      <Source id="drawing-draft-band" type="geojson" data={lineFeature(band ?? [])}>
        {/* Dark under light: a single thin line vanishes on a pale street map
            or a bright satellite tile, whichever colour it is. */}
        <Layer
          id="drawing-draft-band-casing"
          type="line"
          layout={{ 'line-cap': 'round' }}
          paint={{ 'line-color': CASING, 'line-width': 4.5, 'line-opacity': 0.55 }}
        />
        <Layer
          id="drawing-draft-band-line"
          type="line"
          paint={{ 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 1.6] }}
        />
      </Source>

      <Source id="drawing-draft-vertices" type="geojson" data={vertices}>
        <Layer
          id="drawing-draft-vertex"
          type="circle"
          paint={{
            'circle-radius': ['case', ['==', ['get', 'kind'], 'end'], 5.5, 3.5],
            'circle-color': '#ffffff',
            'circle-stroke-color': style.color,
            'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'end'], 3, 2],
          }}
        />
      </Source>

      {/* What the next click will do, said at the pointer. */}
      {interactive && tool === 'points' && cursor && (
        <Marker longitude={cursor[0]} latitude={cursor[1]} anchor="top-left" offset={[14, 14]}>
          <div
            className="px-2 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap tabular-nums"
            style={{
              background: 'rgba(8,15,28,0.92)',
              border: '1px solid rgba(148,163,184,0.22)',
              color: onEnd ? '#fbbf24' : '#e2e8f0',
              boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
            }}
          >
            {onEnd === 'end'
              ? 'Click to end this line'
              : onEnd === 'pickup'
                ? 'Click to continue this line'
                : band
                  ? `+ ${formatDistance(bandMeters)}`
                  : 'Click to start a line'}
          </div>
        </Marker>
      )}
    </>
  )
}
