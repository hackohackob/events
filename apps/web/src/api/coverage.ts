import type {
  CoverageDeadZone,
  CoverageFacets,
  CoverageGridResponse,
  SignalGeneration,
} from '@events/contracts'
import client from './client'

/**
 * Signal coverage survey. Fleet-wide and NOT scoped to an event — the routes
 * live at `/coverage`, not under `/events/:id`, because the whole point is that
 * the survey outlives any single event.
 */

/** Look-back presets, in days. `'all'` drops the lower bound entirely. */
export type CoverageRange = 7 | 30 | 90 | 365 | 'all'

export const COVERAGE_RANGES: readonly CoverageRange[] = [7, 30, 90, 365, 'all']

export const COVERAGE_RANGE_LABELS: Record<string, string> = {
  '7': 'Last week',
  '30': 'Last month',
  '90': 'Last 3 months',
  '365': 'Last year',
  all: 'All time',
}

export interface CoverageFilters {
  range: CoverageRange
  eventIds: string[]
  carriers: string[]
  generations: SignalGeneration[]
}

export const EMPTY_COVERAGE_FILTERS: CoverageFilters = {
  range: 365,
  eventIds: [],
  carriers: [],
  generations: [],
}

/** Ten years is "all time" as far as this fleet is concerned. */
const ALL_TIME_DAYS = 3650

function filterParams(filters: CoverageFilters): Record<string, string | number> {
  const params: Record<string, string | number> = {
    days: filters.range === 'all' ? ALL_TIME_DAYS : filters.range,
  }
  // Omit empty lists rather than sending `carriers=`: an empty value would read
  // as "no carriers match" on the server instead of "don't filter by carrier".
  if (filters.eventIds.length) params.eventIds = filters.eventIds.join(',')
  if (filters.carriers.length) params.carriers = filters.carriers.join(',')
  if (filters.generations.length) params.generations = filters.generations.join(',')
  return params
}

/** `[west, south, east, north]` — what MapLibre's `getBounds().toArray()` flattens to. */
export type CoverageBbox = [number, number, number, number]

export async function fetchCoverageGrid(
  filters: CoverageFilters,
  bbox: CoverageBbox | null,
  cellSize: number,
): Promise<CoverageGridResponse> {
  const { data } = await client.get<CoverageGridResponse>('/coverage/grid', {
    params: {
      ...filterParams(filters),
      cell: cellSize,
      ...(bbox ? { bbox: bbox.join(',') } : {}),
    },
  })
  return data
}

export async function fetchCoverageFacets(filters: CoverageFilters): Promise<CoverageFacets> {
  const { data } = await client.get<CoverageFacets>('/coverage/facets', { params: filterParams(filters) })
  return data
}

export async function fetchCoverageDeadZones(filters: CoverageFilters): Promise<CoverageDeadZone[]> {
  const { data } = await client.get<CoverageDeadZone[]>('/coverage/dead-zones', {
    params: filterParams(filters),
  })
  return data
}
