'use client'

import { Fragment, useMemo } from 'react'
import { Marker, Source, Layer } from 'react-map-gl/maplibre'
import type { MedicTrail } from '@events/contracts'
import { trailColor } from '@events/contracts'
import { positionAt, trailRampColor, trailRuns, formatDuration, formatDurationCompact, type LngLat, type TrailRun } from '@/lib/trail-geometry'

export interface TrailLayersProps {
  trails: MedicTrail[]
  /** Replay cursor (epoch ms). Null shows each trail whole. */
  cursorMs: number | null
  /** Fade every other trail — set while one medic is being inspected. */
  focusMedicId?: string | null
  /** Draw the pauses. Off by default at low zoom, where they'd pile up. */
  showDwells?: boolean
  onDwellClick?: (medicId: string, dwellIndex: number) => void
}

function lineFeature(coordinates: LngLat[]) {
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates } }
}

/**
 * One continuous stretch of a medic's breadcrumbs, drawn as a comet: the line
 * fades from near-transparent at the oldest end to full colour at the newest,
 * so where they are *now* reads at a glance and where they were an hour ago
 * recedes. Done with maplibre's `line-gradient` over `line-progress`, which
 * needs `lineMetrics` on the source and costs nothing per frame — the
 * alternative (one Layer per segment) put hundreds of layers on the map for a
 * single 12h trail.
 *
 * The run carries its own slice of the trail-wide ramp, so the fade stays
 * continuous across the outage breaks between runs.
 */
function TrailRunLine({ trail, run, index, dimmed }: {
  trail: MedicTrail
  run: TrailRun
  index: number
  dimmed: boolean
}) {
  const color = trailColor(trail.medicId)
  const data = useMemo(() => lineFeature(run.coordinates), [run.coordinates])
  const key = `${trail.medicId}-${index}`

  return (
    <Fragment>
      {/* Dark casing so the trail stays legible over satellite imagery. */}
      <Source id={`trail-case-${key}`} type="geojson" data={data}>
        <Layer
          id={`trail-case-l-${key}`}
          type="line"
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          paint={{ 'line-color': 'rgba(8,15,28,0.75)', 'line-width': 6, 'line-opacity': dimmed ? 0.25 : 0.9 }}
        />
      </Source>
      <Source id={`trail-${key}`} type="geojson" data={data} lineMetrics>
        <Layer
          id={`trail-l-${key}`}
          type="line"
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          paint={{
            'line-width': 3.4,
            'line-opacity': dimmed ? 0.28 : 1,
            'line-gradient': [
              'interpolate', ['linear'], ['line-progress'],
              0, trailRampColor(color, run.startFrac),
              1, trailRampColor(color, run.endFrac),
            ],
          }}
        />
      </Source>
    </Fragment>
  )
}

/**
 * A pause, sized by how long it lasted.
 *
 * A PILL, not a circle: the label is what it is, and a fixed-diameter circle
 * wrapped "2h 33m" onto two lines and broke the badge. Height still scales
 * with duration so a long stop reads as bigger, but width follows the text and
 * the label never wraps.
 */
function DwellMarker({ trail, index, dimmed, onClick }: {
  trail: MedicTrail
  index: number
  dimmed: boolean
  onClick?: () => void
}) {
  const dwell = trail.dwells[index]
  const color = trailColor(trail.medicId)
  // 8 min → 22px, 2h+ → 34px. Logarithmic so a three-hour stop doesn't dwarf
  // every other marker on the map.
  const height = Math.round(22 + 12 * Math.min(1, Math.log2(dwell.durationMs / (8 * 60_000)) / 4))

  return (
    <Marker longitude={dwell.lng} latitude={dwell.lat} anchor="center" onClick={onClick}>
      <div
        className="flex items-center justify-center font-black transition-opacity whitespace-nowrap"
        style={{
          height,
          minWidth: height,
          padding: '0 7px',
          borderRadius: 999,
          fontSize: height >= 30 ? 10 : 9,
          lineHeight: 1,
          opacity: dimmed ? 0.3 : 1,
          color: '#0a1220',
          background: color,
          border: '2px solid rgba(8,15,28,0.85)',
          boxShadow: `0 0 0 3px ${hexToRgba(color, 0.18)}, 0 2px 8px rgba(0,0,0,0.5)`,
          cursor: onClick ? 'pointer' : 'default',
        }}
        title={`Held position for ${formatDuration(dwell.durationMs)}`}
      >
        {formatDurationCompact(dwell.durationMs)}
      </div>
    </Marker>
  )
}

/** Where the medic was at the scrub time — the head of the comet. */
function ReplayPuck({ trail, position, dimmed }: { trail: MedicTrail; position: LngLat; dimmed: boolean }) {
  const color = trailColor(trail.medicId)
  return (
    <Marker longitude={position[0]} latitude={position[1]} anchor="center">
      <div className="relative flex items-center justify-center" style={{ opacity: dimmed ? 0.35 : 1 }}>
        <div
          className="absolute rounded-full animate-ping"
          style={{ width: 26, height: 26, background: hexToRgba(color, 0.35) }}
        />
        <div
          className="relative rounded-full flex items-center justify-center text-[9px] font-black"
          style={{
            width: 18,
            height: 18,
            background: color,
            color: '#0a1220',
            border: '2px solid rgba(255,255,255,0.85)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.6)',
          }}
        >
          {initials(trail.name)}
        </div>
      </div>
    </Marker>
  )
}

/**
 * Every selected medic's history on the map. With `cursorMs` set this becomes a
 * replay: each trail is clipped to what had happened by that moment and a puck
 * marks where the medic stood.
 */
export default function TrailLayers({
  trails,
  cursorMs,
  focusMedicId,
  showDwells = true,
  onDwellClick,
}: TrailLayersProps) {
  const rendered = useMemo(
    () =>
      trails.map((trail) => ({
        trail,
        runs: trailRuns(trail, cursorMs ?? undefined),
        puck: cursorMs == null ? null : positionAt(trail, cursorMs),
      })),
    [trails, cursorMs],
  )

  return (
    <Fragment>
      {rendered.map(({ trail, runs, puck }) => {
        const dimmed = !!focusMedicId && focusMedicId !== trail.medicId
        return (
          <Fragment key={`trail-${trail.medicId}`}>
            {runs.map((run, index) => (
              <TrailRunLine
                key={`run-${trail.medicId}-${index}`}
                trail={trail}
                run={run}
                index={index}
                dimmed={dimmed}
              />
            ))}
            {showDwells &&
              trail.dwells.map((dwell, index) =>
                // During a replay, a pause only exists once it has been reached.
                cursorMs != null && new Date(dwell.from).getTime() > cursorMs ? null : (
                  <DwellMarker
                    key={`dwell-${trail.medicId}-${index}`}
                    trail={trail}
                    index={index}
                    dimmed={dimmed}
                    onClick={onDwellClick ? () => onDwellClick(trail.medicId, index) : undefined}
                  />
                ),
              )}
            {puck && <ReplayPuck trail={trail} position={puck} dimmed={dimmed} />}
          </Fragment>
        )
      })}
    </Fragment>
  )
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
