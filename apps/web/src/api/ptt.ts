import client from './client'
import type {
  PttChannelKind,
  PttEventRoutes,
  PttOverview,
  PttProviderStatus,
  UpdatePttProviderRequest,
} from '@events/contracts'

export interface PttActivityEntry {
  at: string
  kind: string
  level: string
  message: string
}

export async function fetchPttOverview(): Promise<PttOverview> {
  const res = await client.get<PttOverview>('/ptt/providers')
  return res.data
}

export async function fetchPttStatuses(): Promise<PttProviderStatus[]> {
  const res = await client.get<PttProviderStatus[]>('/ptt/status')
  return res.data
}

export async function fetchPttActivity(): Promise<PttActivityEntry[]> {
  const res = await client.get<PttActivityEntry[]>('/ptt/activity')
  return res.data
}

export async function updatePttProvider(
  kind: PttChannelKind,
  patch: UpdatePttProviderRequest,
): Promise<PttOverview> {
  const res = await client.put<PttOverview>(`/ptt/providers/${kind}`, patch)
  return res.data
}

export async function sendPttTest(kind: PttChannelKind, text?: string): Promise<void> {
  await client.post(`/ptt/providers/${kind}/test`, { text })
}

export async function fetchPttRoutes(eventId: string): Promise<PttEventRoutes> {
  const res = await client.get<PttEventRoutes>('/ptt/routes', { params: { eventId } })
  return res.data
}

export async function updatePttRoute(
  eventId: string,
  kind: PttChannelKind,
  patch: { inbound?: boolean; outbound?: boolean },
): Promise<PttEventRoutes> {
  const res = await client.put<PttEventRoutes>('/ptt/routes', { eventId, kind, ...patch })
  return res.data
}
