'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapGL, { Layer, NavigationControl, Popup, Source } from 'react-map-gl/maplibre'
import type { MapLayerMouseEvent, MapRef } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Crosshair,
  Layers,
  Loader2,
  RadioTower,
  RefreshCw,
  Signal,
  SignalZero,
  X,
} from 'lucide-react'
import type { CoverageCell, CoverageDeadZone, SignalGeneration } from '@events/contracts'
import {
  COVERAGE_CELL_SIZES,
  SIGNAL_BAR_COLORS,
  SIGNAL_BAR_LABELS,
  coverageCellForZoom,
  signalBarLabel,
} from '@events/contracts'
import { fetchEvents } from '@/api/events'
import {
  COVERAGE_RANGES,
  COVERAGE_RANGE_LABELS,
  EMPTY_COVERAGE_FILTERS,
  fetchCoverageDeadZones,
  fetchCoverageFacets,
  fetchCoverageGrid,
  type CoverageBbox,
  type CoverageFilters,
  type CoverageRange,
} from '@/api/coverage'
import { styleFor } from '@/lib/map-styles'
import {
  barsColor,
  cellPolygons,
  cellsBbox,
  metricValue,
  weaknessPoints,
  type CoverageMetric,
} from './coverage-geometry'

/** Bulgaria, where the fleet works — the view before any data has loaded. */
const HOME_VIEW = { longitude: 25.48, latitude: 42.73, zoom: 6.4 }

/** Coarsest grid, used for the "where does data exist at all" overview fetch. */
const OVERVIEW_CELL = COVERAGE_CELL_SIZES[0]

/** Pan settles before we ask the server for a new grid. */
const MOVE_DEBOUNCE_MS = 280

const FILL_LAYER_ID = 'coverage-cells-fill'

const CARD: React.CSSProperties = {
  background: 'rgba(20,33,61,0.8)',
  border: '1px solid rgba(148,163,184,0.08)',
  backdropFilter: 'blur(8px)',
}

const GENERATION_LABELS: Record<SignalGeneration, string> = {
  '2g': '2G', '3g': '3G', '4g': '4G', '5g': '5G',
  wifi: 'Wi-Fi', none: 'No service', unknown: 'Unknown',
}

export default function CoverageConsole() {
  const mapRef = useRef<MapRef | null>(null)
  const [filters, setFilters] = useState<CoverageFilters>(EMPTY_COVERAGE_FILTERS)
  // Squares by default. The heat layer only paints where signal is BAD, so on
  // its own a well-covered area is indistinguishable from unsurveyed ground —
  // the squares answer "is there signal here?" at a glance, which is the
  // question this page exists to answer.
  const [view, setView] = useState<'cells' | 'heatmap'>('cells')
  const [metric, setMetric] = useState<CoverageMetric>('average')
  const [bbox, setBbox] = useState<CoverageBbox | null>(null)
  const [cellSize, setCellSize] = useState<number>(coverageCellForZoom(HOME_VIEW.zoom))
  const [selected, setSelected] = useState<{ cell: CoverageCell; lat: number; lng: number } | null>(null)

  // ── Data ───────────────────────────────────────────────────────────────────

  const facetsQuery = useQuery({
    queryKey: ['coverage-facets', filters],
    queryFn: () => fetchCoverageFacets(filters),
    staleTime: 60_000,
  })

  // Deliberately unbounded: this is what tells us WHERE in the world the survey
  // has anything, so the map can open on the data instead of on a guess.
  const overviewQuery = useQuery({
    queryKey: ['coverage-overview', filters],
    queryFn: () => fetchCoverageGrid(filters, null, OVERVIEW_CELL),
    staleTime: 60_000,
  })

  const gridQuery = useQuery({
    queryKey: ['coverage-grid', filters, bbox, cellSize],
    queryFn: () => fetchCoverageGrid(filters, bbox, cellSize),
    enabled: bbox !== null,
    // Keep the last grid on screen while the next one loads, so panning doesn't
    // blink the map empty on every move.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  // The survey stores only event ids; names come from the dashboard's own event
  // list, which is already cached here for every other page.
  const eventsQuery = useQuery({
    queryKey: ['events'],
    queryFn: fetchEvents,
    staleTime: 60_000,
  })

  const eventTitle = useMemo(() => {
    const titles = new Map((eventsQuery.data ?? []).map((event) => [event.id, event.title]))
    // An event deleted from the roster still has survey data worth keeping on
    // the map — it just loses its name.
    return (eventId: string) => titles.get(eventId) ?? 'Past event'
  }, [eventsQuery.data])

  const deadZonesQuery = useQuery({
    queryKey: ['coverage-dead-zones', filters],
    queryFn: () => fetchCoverageDeadZones(filters),
    staleTime: 60_000,
  })

  const cells = useMemo(() => gridQuery.data?.cells ?? [], [gridQuery.data])
  const facets = facetsQuery.data
  const deadZones = deadZonesQuery.data ?? []

  // Totals come from the unbounded overview, not the viewport grid: "we have
  // 412k samples" should not change because you panned.
  const totals = overviewQuery.data?.summary

  // ── Auto-fit to the survey ─────────────────────────────────────────────────

  // Re-fit whenever the filter set changes, but never while the operator is
  // simply panning — `fittedKey` records which filter set we last fitted for.
  const fittedKey = useRef<string | null>(null)
  const filterKey = JSON.stringify(filters)

  const fitTo = useCallback((box: CoverageBbox) => {
    const map = mapRef.current
    if (!map) return
    map.fitBounds(
      [[box[0], box[1]], [box[2], box[3]]],
      { padding: 64, duration: 700, maxZoom: 13 },
    )
  }, [])

  useEffect(() => {
    if (!overviewQuery.data) return
    if (fittedKey.current === filterKey) return
    const box = cellsBbox(overviewQuery.data.cells, OVERVIEW_CELL)
    fittedKey.current = filterKey
    if (box) fitTo(box)
  }, [overviewQuery.data, filterKey, fitTo])

  // ── Viewport → query params ────────────────────────────────────────────────

  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const syncViewport = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const bounds = map.getBounds()
    const zoom = map.getZoom()
    setBbox([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()])
    setCellSize(coverageCellForZoom(zoom))
  }, [])

  const onMove = useCallback(() => {
    if (moveTimer.current) clearTimeout(moveTimer.current)
    moveTimer.current = setTimeout(syncViewport, MOVE_DEBOUNCE_MS)
  }, [syncViewport])

  useEffect(() => () => {
    if (moveTimer.current) clearTimeout(moveTimer.current)
  }, [])

  // A selected cell is a reading of one grid square under one filter set. Change
  // the filters, the metric or the view and it no longer describes what is on
  // screen, so it goes rather than sitting there contradicting the map.
  useEffect(() => {
    setSelected(null)
  }, [filterKey, metric, view])

  // ── Map interaction ────────────────────────────────────────────────────────

  const onMapClick = useCallback((event: MapLayerMouseEvent) => {
    const feature = event.features?.[0]
    const index = feature?.properties?.index
    if (typeof index !== 'number' || !cells[index]) {
      setSelected(null)
      return
    }
    setSelected({ cell: cells[index], lat: event.lngLat.lat, lng: event.lngLat.lng })
  }, [cells])

  const flyToZone = useCallback((zone: CoverageDeadZone) => {
    mapRef.current?.flyTo({ center: [zone.lng, zone.lat], zoom: 14.5, duration: 900 })
  }, [])

  // ── Derived layers ─────────────────────────────────────────────────────────

  const polygons = useMemo(
    () => cellPolygons(cells, gridQuery.data?.cellSize ?? cellSize, metric),
    [cells, gridQuery.data?.cellSize, cellSize, metric],
  )
  const heatPoints = useMemo(() => weaknessPoints(cells, metric), [cells, metric])

  const deadZonePoints = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: 'FeatureCollection',
    features: deadZones.map((zone) => ({
      type: 'Feature' as const,
      properties: { samples: zone.samples },
      geometry: { type: 'Point' as const, coordinates: [zone.lng, zone.lat] },
    })),
  }), [deadZones])

  const mapStyle = useMemo(() => styleFor('streets', false), [])

  const loading = gridQuery.isFetching || overviewQuery.isLoading
  const hasAnyData = (totals?.samples ?? 0) > 0

  // ── Filter helpers ─────────────────────────────────────────────────────────

  const toggleCarrier = (carrier: string) =>
    setFilters((f) => ({
      ...f,
      carriers: f.carriers.includes(carrier)
        ? f.carriers.filter((c) => c !== carrier)
        : [...f.carriers, carrier],
    }))

  const toggleEvent = (eventId: string) =>
    setFilters((f) => ({
      ...f,
      eventIds: f.eventIds.includes(eventId)
        ? f.eventIds.filter((e) => e !== eventId)
        : [...f.eventIds, eventId],
    }))

  const setRange = (range: CoverageRange) => setFilters((f) => ({ ...f, range }))

  const filtersActive =
    filters.carriers.length > 0 || filters.eventIds.length > 0 || filters.generations.length > 0

  return (
    // h-screen, not flex-1: the shell's <main> only sets a MINIMUM height, so
    // without a hard cap the rail's content stretches the page and the whole
    // console scrolls — taking the map's header off screen — instead of the
    // rail scrolling inside it.
    <div className="flex flex-col h-screen min-h-0">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between gap-4 px-8 py-5 flex-wrap"
        style={{ borderBottom: '1px solid rgba(148,163,184,0.08)', background: 'rgba(12,21,39,0.6)', backdropFilter: 'blur(12px)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.18), rgba(34,197,94,0.06))', boxShadow: 'inset 0 0 0 1px rgba(34,197,94,0.2)' }}
          >
            <RadioTower className="w-5 h-5" style={{ color: '#22c55e' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">Signal Coverage</h1>
            <p className="text-sm mt-0.5" style={{ color: '#64748b' }}>
              {totals
                ? `${formatCount(totals.samples)} readings from every event · average ${totals.meanBars.toFixed(1)}/4`
                : 'Where your medics have data — surveyed as they work'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Segmented
            options={[
              { value: 'cells', label: 'Coverage', icon: Signal },
              { value: 'heatmap', label: 'Trouble heat', icon: Layers },
            ]}
            value={view}
            onChange={(v) => setView(v as 'cells' | 'heatmap')}
          />
          <Segmented
            options={[
              { value: 'average', label: 'Average' },
              { value: 'worst', label: 'Worst case' },
            ]}
            value={metric}
            onChange={(v) => setMetric(v as CoverageMetric)}
          />
          <button
            onClick={() => {
              const box = cellsBbox(overviewQuery.data?.cells ?? [], OVERVIEW_CELL)
              if (box) fitTo(box)
            }}
            disabled={!hasAnyData}
            title="Zoom out to everything the survey covers"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all active:scale-95 disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.12)', color: '#cbd5e1' }}
          >
            <Crosshair className="w-4 h-4" />
            Fit
          </button>
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-8 py-3 flex-wrap"
        style={{ borderBottom: '1px solid rgba(148,163,184,0.06)' }}
      >
        <div className="flex items-center gap-1.5">
          {COVERAGE_RANGES.map((range) => (
            <Chip
              key={String(range)}
              label={COVERAGE_RANGE_LABELS[String(range)]}
              active={filters.range === range}
              onClick={() => setRange(range)}
            />
          ))}
        </div>

        {(facets?.carriers.length ?? 0) > 0 && (
          <>
            <Divider />
            <div className="flex items-center gap-1.5 flex-wrap">
              {facets!.carriers.slice(0, 6).map((carrier) => (
                <Chip
                  key={carrier.carrier}
                  label={carrier.carrier}
                  sub={`${carrier.meanBars.toFixed(1)}/4`}
                  active={filters.carriers.includes(carrier.carrier)}
                  onClick={() => toggleCarrier(carrier.carrier)}
                />
              ))}
            </div>
          </>
        )}

        {(facets?.events.length ?? 0) > 0 && (
          <>
            <Divider />
            <EventFilter
              events={facets!.events.map((event) => ({ ...event, title: eventTitle(event.eventId) }))}
              selected={filters.eventIds}
              onToggle={toggleEvent}
            />
          </>
        )}

        {filtersActive && (
          <button
            onClick={() => setFilters((f) => ({ ...EMPTY_COVERAGE_FILTERS, range: f.range }))}
            className="flex items-center gap-1.5 text-xs font-medium transition-colors"
            style={{ color: '#64748b' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#cbd5e1')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#64748b')}
          >
            <X className="w-3.5 h-3.5" /> Clear filters
          </button>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs" style={{ color: '#64748b' }}>
          {loading ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading survey…</>
          ) : (
            <><RefreshCw className="w-3.5 h-3.5" /> {formatCount(cells.length)} cells in view</>
          )}
        </div>
      </div>

      {/* ── Map + rail ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        <div className="relative flex-1 min-w-0">
          <MapGL
            ref={mapRef}
            initialViewState={HOME_VIEW}
            mapStyle={mapStyle}
            onLoad={syncViewport}
            onMoveEnd={onMove}
            onClick={onMapClick}
            interactiveLayerIds={view === 'cells' ? [FILL_LAYER_ID] : []}
            cursor={view === 'cells' ? 'pointer' : 'grab'}
            style={{ width: '100%', height: '100%' }}
          >
            <NavigationControl position="bottom-right" showCompass={false} />

            {/* Weakness heatmap — blooms where medics struggle to get a message out. */}
            {view === 'heatmap' && heatPoints.features.length > 0 && (
              <Source id="coverage-heat" type="geojson" data={heatPoints}>
                <Layer
                  id="coverage-heat-layer"
                  type="heatmap"
                  paint={{
                    'heatmap-weight': ['get', 'w'],
                    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 10, 2, 15, 3.4],
                    'heatmap-color': [
                      'interpolate', ['linear'], ['heatmap-density'],
                      0, 'rgba(0,0,0,0)',
                      0.15, 'rgba(250,204,21,0.35)',
                      0.4, 'rgba(249,115,22,0.6)',
                      0.7, 'rgba(239,68,68,0.78)',
                      1, 'rgba(159,18,57,0.9)',
                    ],
                    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 5, 14, 10, 26, 14, 44, 18, 70],
                    'heatmap-opacity': 0.85,
                  }}
                />
              </Source>
            )}

            {/* Crisp measured cells. Each square is exactly what was sampled. */}
            {view === 'cells' && polygons.features.length > 0 && (
              <Source id="coverage-cells" type="geojson" data={polygons}>
                <Layer
                  id={FILL_LAYER_ID}
                  type="fill"
                  paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': 0.62 }}
                />
                <Layer
                  id="coverage-cells-outline"
                  type="line"
                  paint={{
                    'line-color': ['get', 'color'],
                    // Outlines only make sense once squares are big enough to
                    // have edges; at low zoom they'd be a grey haze.
                    'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.55],
                    'line-width': 1,
                  }}
                />
              </Source>
            )}

            {/* Confirmed black spots, always visible in both views. */}
            {deadZonePoints.features.length > 0 && (
              <Source id="coverage-dead" type="geojson" data={deadZonePoints}>
                <Layer
                  id="coverage-dead-layer"
                  type="circle"
                  paint={{
                    'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 6, 16, 10],
                    'circle-color': 'rgba(239,68,68,0)',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ef4444',
                  }}
                />
              </Source>
            )}

            {selected && (
              <Popup
                longitude={selected.lng}
                latitude={selected.lat}
                anchor="bottom"
                closeButton={false}
                onClose={() => setSelected(null)}
                maxWidth="280px"
                className="coverage-popup"
              >
                <CellDetail cell={selected.cell} metric={metric} onClose={() => setSelected(null)} />
              </Popup>
            )}
          </MapGL>

          {/* Legend */}
          <div
            className="absolute left-4 bottom-4 rounded-2xl px-4 py-3 pointer-events-none"
            style={{ ...CARD, boxShadow: '0 12px 32px rgba(0,0,0,0.4)' }}
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: '#64748b' }}>
              {view === 'heatmap' ? 'Trouble intensity' : metric === 'worst' ? 'Worst reading' : 'Average signal'}
            </div>
            {view === 'heatmap' ? (
              <>
                <div
                  className="h-2 w-52 rounded-full"
                  style={{ background: 'linear-gradient(90deg, rgba(250,204,21,0.45), #f97316, #ef4444, #9f1239)' }}
                />
                <div className="flex justify-between mt-1.5 text-[10px]" style={{ color: '#94a3b8' }}>
                  <span>Occasional trouble</span>
                  <span>Consistently dead</span>
                </div>
                <div className="text-[10px] mt-1.5" style={{ color: '#64748b' }}>
                  Unpainted ground is either fine or unsurveyed — switch to
                  Coverage to tell them apart.
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                {SIGNAL_BAR_LABELS.map((label, bars) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded" style={{ background: SIGNAL_BAR_COLORS[bars] }} />
                    <span className="text-[10px]" style={{ color: '#94a3b8' }}>{label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Truncation notice — never quietly draw a partial survey. */}
          {gridQuery.data?.truncated && (
            <div
              className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-xl text-xs"
              style={{ ...CARD, color: '#fbbf24' }}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Too much data for one view — zoom in to see all of it
            </div>
          )}

          {/* Empty state */}
          {!loading && !hasAnyData && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="flex flex-col items-center gap-3 px-8 py-7 rounded-2xl text-center" style={{ ...CARD, maxWidth: 360 }}>
                <SignalZero className="w-8 h-8" style={{ color: '#475569' }} />
                <div className="text-sm font-semibold text-slate-200">No readings yet</div>
                <p className="text-xs leading-relaxed" style={{ color: '#64748b' }}>
                  The survey fills itself in as medics work an active event — every
                  location report carries the signal it was sent on. Give it a shift.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Right rail ─────────────────────────────────────────────────── */}
        <aside
          className="w-[320px] flex-shrink-0 overflow-y-auto hidden xl:block"
          style={{ borderLeft: '1px solid rgba(148,163,184,0.08)', background: 'rgba(10,20,36,0.5)' }}
        >
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Readings" value={formatCount(totals?.samples ?? 0)} tone="#38bdf8" />
              <Stat
                label="Average signal"
                value={totals ? `${totals.meanBars.toFixed(1)}/4` : '—'}
                tone={totals ? barsColor(totals.meanBars) : '#64748b'}
              />
              <Stat label="Weak cells in view" value={formatCount(gridQuery.data?.summary.weakCells ?? 0)} tone="#f59e0b" />
              <Stat label="Black spots" value={formatCount(deadZones.length)} tone="#ef4444" />
            </div>

            {(facets?.generations.length ?? 0) > 0 && (
              <Panel title="Networks seen">
                <div className="space-y-2">
                  {facets!.generations.map((gen) => {
                    const share = totals?.samples ? gen.samples / totals.samples : 0
                    return (
                      <div key={gen.generation}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-slate-300 font-medium">{GENERATION_LABELS[gen.generation] ?? gen.generation}</span>
                          <span style={{ color: '#64748b' }}>{Math.round(share * 100)}%</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(148,163,184,0.1)' }}>
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${Math.max(2, share * 100)}%`, background: gen.generation === 'none' ? '#ef4444' : '#38bdf8' }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Panel>
            )}

            {(facets?.carriers.length ?? 0) > 0 && (
              <Panel title="Carriers" hint="Average signal across every reading">
                <div className="space-y-2.5">
                  {facets!.carriers.slice(0, 8).map((carrier) => (
                    <div key={carrier.carrier} className="flex items-center gap-3">
                      <span className="flex-1 min-w-0 truncate text-xs font-medium text-slate-300">{carrier.carrier}</span>
                      <div className="w-20 h-1.5 rounded-full overflow-hidden flex-shrink-0" style={{ background: 'rgba(148,163,184,0.1)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(carrier.meanBars / 4) * 100}%`, background: barsColor(carrier.meanBars) }}
                        />
                      </div>
                      <span className="text-xs tabular-nums w-8 text-right" style={{ color: '#94a3b8' }}>
                        {carrier.meanBars.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            <Panel
              title="Black spots"
              hint="Places where every single reading had no usable data"
            >
              {deadZonesQuery.isLoading ? (
                <div className="flex items-center gap-2 text-xs py-3" style={{ color: '#64748b' }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…
                </div>
              ) : deadZones.length === 0 ? (
                <p className="text-xs leading-relaxed py-1" style={{ color: '#64748b' }}>
                  None found in this range. Every surveyed spot got something out.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {deadZones.slice(0, 12).map((zone) => (
                    <button
                      key={`${zone.lat},${zone.lng}`}
                      onClick={() => flyToZone(zone)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all active:scale-[0.98]"
                      style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.15)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.13)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.07)')}
                    >
                      <SignalZero className="w-4 h-4 flex-shrink-0" style={{ color: '#f87171' }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-200 tabular-nums">
                          {zone.lat.toFixed(4)}, {zone.lng.toFixed(4)}
                        </div>
                        <div className="text-[11px] mt-0.5" style={{ color: '#94a3b8' }}>
                          {zone.samples} readings · {zone.medics} {zone.medics === 1 ? 'medic' : 'medics'}
                          {zone.carriers.length > 0 && ` · ${zone.carriers.join(', ')}`}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Panel>

            <p className="text-[11px] leading-relaxed px-1" style={{ color: '#475569' }}>
              Signal is scored 0–4 from the network the phone was on and whether its
              reports actually got through — it measures whether a medic can reach
              you from a spot, not antenna strength.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function CellDetail({ cell, metric, onClose }: { cell: CoverageCell; metric: CoverageMetric; onClose: () => void }) {
  const value = metricValue(cell, metric)
  return (
    <div className="p-1 w-full" style={{ minWidth: 200 }}>
      <div className="flex items-start gap-2.5 mb-2.5">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${barsColor(value)}22` }}>
          <Signal className="w-4 h-4" style={{ color: barsColor(value) }} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold" style={{ color: barsColor(value) }}>{signalBarLabel(value)}</div>
          <div className="text-[11px]" style={{ color: '#94a3b8' }}>
            {cell.bars.toFixed(1)}/4 average · worst {cell.worstBars}/4
          </div>
        </div>
        <button onClick={onClose} className="flex-shrink-0 p-0.5 rounded" style={{ color: '#64748b' }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <dl className="space-y-1 text-[11px]">
        <Row label="Readings" value={`${cell.samples}`} />
        {cell.deadRatio > 0 && (
          <Row label="Dead readings" value={`${Math.round(cell.deadRatio * 100)}%`} tone="#f87171" />
        )}
        {cell.latencyMs != null && (
          <Row label="Typical round-trip" value={`${cell.latencyMs} ms`} />
        )}
        {cell.generation && cell.generation !== 'unknown' && (
          <Row label="Network" value={GENERATION_LABELS[cell.generation] ?? cell.generation} />
        )}
        {cell.carriers.length > 0 && <Row label="Carriers" value={cell.carriers.join(', ')} />}
        <Row label="Last seen" value={formatDate(cell.lastSeenAt)} />
      </dl>
    </div>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt style={{ color: '#64748b' }}>{label}</dt>
      <dd className="font-medium text-right" style={{ color: tone ?? '#cbd5e1' }}>{value}</dd>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl px-3.5 py-3" style={CARD}>
      <div className="text-lg font-bold tabular-nums leading-tight" style={{ color: tone }}>{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wider mt-0.5" style={{ color: '#64748b' }}>{label}</div>
    </div>
  )
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl p-4" style={CARD}>
      <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-300">{title}</h2>
      {hint && <p className="text-[11px] mt-0.5 mb-3 leading-relaxed" style={{ color: '#64748b' }}>{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  )
}

function Chip({ label, sub, active, onClick }: { label: string; sub?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-95 whitespace-nowrap"
      style={active
        ? { background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.35)', color: '#4ade80' }
        : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.1)', color: '#94a3b8' }}
    >
      {label}
      {sub && <span className="ml-1.5 opacity-60 tabular-nums">{sub}</span>}
    </button>
  )
}

function Segmented({
  options, value, onChange,
}: {
  options: { value: string; label: string; icon?: React.ComponentType<{ className?: string }> }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.1)' }}>
      {options.map(({ value: option, label, icon: Icon }) => {
        const active = option === value
        return (
          <button
            key={option}
            onClick={() => onChange(option)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all"
            style={active
              ? { background: 'rgba(34,197,94,0.16)', color: '#4ade80', boxShadow: 'inset 0 0 0 1px rgba(34,197,94,0.25)' }
              : { color: '#64748b' }}
          >
            {Icon && <Icon className="w-3.5 h-3.5" />}
            {label}
          </button>
        )
      })}
    </div>
  )
}

function Divider() {
  return <span className="w-px h-5" style={{ background: 'rgba(148,163,184,0.12)' }} />
}

/** Events are a long list, so they get a dropdown rather than a chip row. */
function EventFilter({
  events, selected, onToggle,
}: {
  events: { eventId: string; title: string; samples: number }[]
  selected: string[]
  onToggle: (eventId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <Chip
        label={selected.length ? `${selected.length} event${selected.length > 1 ? 's' : ''}` : 'All events'}
        active={selected.length > 0}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div
          className="absolute top-full left-0 mt-2 w-[280px] max-h-[320px] overflow-y-auto rounded-xl p-1.5 z-50"
          style={{ background: '#0a1424', border: '1px solid rgba(148,163,184,0.12)', boxShadow: '0 20px 48px rgba(0,0,0,0.55)' }}
        >
          {events.map((event) => {
            const active = selected.includes(event.eventId)
            return (
              <button
                key={event.eventId}
                onClick={() => onToggle(event.eventId)}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors"
                style={{ background: active ? 'rgba(34,197,94,0.12)' : 'transparent' }}
              >
                <span
                  className="w-3.5 h-3.5 rounded flex-shrink-0"
                  style={{ border: `1px solid ${active ? '#22c55e' : 'rgba(148,163,184,0.3)'}`, background: active ? '#22c55e' : 'transparent' }}
                />
                <span className="flex-1 min-w-0 truncate text-xs text-slate-300">{event.title}</span>
                <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: '#64748b' }}>
                  {formatCount(event.samples)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1_000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
