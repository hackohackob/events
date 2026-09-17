import type { CoverageCell } from '@events/contracts'
import { SIGNAL_BAR_COLORS } from '@events/contracts'
import type { CoverageBbox } from '@/api/coverage'

/**
 * Turning the survey's grid cells into things MapLibre can draw.
 *
 * Cells arrive as centre points plus the grid size they were bucketed at, so
 * every geometry here is reconstructed rather than sent over the wire — a
 * square is five coordinates the client can derive from two.
 */

export interface CellFeatureProperties {
  bars: number
  worstBars: number
  samples: number
  deadRatio: number
  latencyMs: number | null
  /** Pre-resolved fill, so the paint expression stays a plain `['get']`. */
  color: string
  /** The metric being painted, 0–4. Drives opacity: no-coverage squares are
   *  drawn near-solid so the black reads as black rather than grey. */
  value: number
  /** Index back into the cell array for the detail popup. */
  index: number
}

export type CoverageMetric = 'average' | 'worst'

/** The value the map paints for a cell, given the selected metric. */
export function metricValue(cell: CoverageCell, metric: CoverageMetric): number {
  return metric === 'worst' ? cell.worstBars : cell.bars
}

/**
 * Continuous 0–4 colour. {@link SIGNAL_BAR_COLORS} gives the five anchors;
 * fractional means are blended between them so a cell averaging 2.5 doesn't
 * snap to a bar it never measured.
 */
export function barsColor(bars: number): string {
  const clamped = Math.max(0, Math.min(4, bars))
  const lower = Math.floor(clamped)
  const upper = Math.min(4, lower + 1)
  return mixHex(SIGNAL_BAR_COLORS[lower], SIGNAL_BAR_COLORS[upper], clamped - lower)
}

function mixHex(a: string, b: string, t: number): string {
  if (t <= 0) return a
  if (t >= 1) return b
  const pa = parseHex(a)
  const pb = parseHex(b)
  const ch = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * t)
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`
}

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ]
}

/** Grid squares, ready for a fill layer. */
export function cellPolygons(
  cells: CoverageCell[],
  cellSize: number,
  metric: CoverageMetric,
): GeoJSON.FeatureCollection<GeoJSON.Polygon, CellFeatureProperties> {
  const half = cellSize / 2
  return {
    type: 'FeatureCollection',
    features: cells.map((cell, index) => {
      const value = metricValue(cell, metric)
      return {
        type: 'Feature' as const,
        properties: {
          bars: cell.bars,
          worstBars: cell.worstBars,
          samples: cell.samples,
          deadRatio: cell.deadRatio,
          latencyMs: cell.latencyMs ?? null,
          color: barsColor(value),
          value,
          index,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [cell.lng - half, cell.lat - half],
            [cell.lng + half, cell.lat - half],
            [cell.lng + half, cell.lat + half],
            [cell.lng - half, cell.lat + half],
            [cell.lng - half, cell.lat - half],
          ]],
        },
      }
    }),
  }
}

/**
 * Cell centres for the heatmap layer, weighted by how BAD the signal is.
 *
 * MapLibre's heatmap blends by point density, which on its own would say
 * "we walked here a lot", not "it's bad here". Weighting by weakness and
 * normalising by sample count keeps the bloom on the problem areas: a cell
 * surveyed once with no signal and a cell surveyed a hundred times with no
 * signal both read as trouble, and a well-covered good cell contributes
 * nothing at all.
 */
export function weaknessPoints(
  cells: CoverageCell[],
  metric: CoverageMetric,
): GeoJSON.FeatureCollection<GeoJSON.Point, { w: number }> {
  return {
    type: 'FeatureCollection',
    features: cells
      .map((cell) => ({ cell, weakness: (4 - metricValue(cell, metric)) / 4 }))
      .filter(({ weakness }) => weakness > 0.02)
      .map(({ cell, weakness }) => ({
        type: 'Feature' as const,
        properties: { w: Math.round(weakness * 100) / 100 },
        geometry: { type: 'Point' as const, coordinates: [cell.lng, cell.lat] },
      })),
  }
}

/** Bounding box around every cell, padded by half a grid step. Null when empty. */
export function cellsBbox(cells: CoverageCell[], cellSize: number): CoverageBbox | null {
  if (cells.length === 0) return null
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const cell of cells) {
    if (cell.lng < west) west = cell.lng
    if (cell.lng > east) east = cell.lng
    if (cell.lat < south) south = cell.lat
    if (cell.lat > north) north = cell.lat
  }
  const pad = cellSize
  return [west - pad, south - pad, east + pad, north + pad]
}
