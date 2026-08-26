import type { MedicTrail, TrailBundle } from '@events/contracts'
import client from './client'

export interface TrailSummary {
  medicId: string
  name: string
  points: number
  firstAt: string
  lastAt: string
}

/**
 * Which span to ask for. A number is a rolling lookback in hours; `'event'`
 * asks for the archive — the event's own days and daily window, however long
 * ago it ran.
 */
export type TrailWindow = 1 | 3 | 6 | 12 | 'event'

export const TRAIL_WINDOWS: readonly TrailWindow[] = [1, 3, 6, 12, 'event']

/** Translate the picker's single value into the two query params the API takes. */
function windowParams(window: TrailWindow): { hours?: number; window?: string } {
  return window === 'event' ? { window: 'event' } : { hours: window }
}

/** Medics that have breadcrumbs in the window. Coordinators only. */
export async function listTrails(eventId: string, window: TrailWindow = 12): Promise<TrailSummary[]> {
  const { data } = await client.get<TrailSummary[]>(`/events/${eventId}/trails`, { params: windowParams(window) })
  return data
}

export async function getTrail(eventId: string, medicId: string, window: TrailWindow = 12): Promise<MedicTrail> {
  const { data } = await client.get<MedicTrail>(`/events/${eventId}/trails/${medicId}`, { params: windowParams(window) })
  return data
}

/** Several medics in one round trip — the replay view's workhorse. */
export async function getTrailBundle(
  eventId: string,
  medicIds: string[],
  window: TrailWindow = 12,
): Promise<TrailBundle> {
  const { data } = await client.get<TrailBundle>(`/events/${eventId}/trails/bundle`, {
    params: { medicIds: medicIds.join(','), ...windowParams(window) },
  })
  return data
}
