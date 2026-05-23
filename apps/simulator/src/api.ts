// API + WS communication with the backend

import { io, Socket } from 'socket.io-client'
import type { SimEntity } from './simulation'

export interface LogEntry {
  id: string
  ts: string
  type: 'info' | 'success' | 'error' | 'ws'
  message: string
}

type LogFn = (entry: Omit<LogEntry, 'id' | 'ts'>) => void

// Per-medic socket map: medicId (sim entity id) → Socket
const medicSockets = new Map<string, Socket>()

let apiBase = 'http://localhost:8500'
let wsBase = 'http://localhost:8500'

export function setApiBase(url: string) {
  apiBase = url.replace(/\/$/, '')
  wsBase = apiBase
}

export function connectMedicSocket(medicEntityId: string, eventId: string, token: string, log: LogFn): Socket {
  // Disconnect existing socket for this entity if any
  medicSockets.get(medicEntityId)?.disconnect()

  const socket = io(`${wsBase}/realtime`, {
    transports: ['websocket'],
    auth: { token, eventId, role: 'medic' },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  })

  socket.on('connect', () => log({ type: 'ws', message: `[M] socket connected (${socket.id?.slice(0, 8)})` }))
  socket.on('disconnect', (reason) => log({ type: 'info', message: `[M] socket disconnected: ${reason}` }))
  socket.on('connect_error', (err) => log({ type: 'error', message: `[M] socket error: ${err.message}` }))

  medicSockets.set(medicEntityId, socket)
  return socket
}

export function disconnectMedicSocket(medicEntityId: string) {
  medicSockets.get(medicEntityId)?.disconnect()
  medicSockets.delete(medicEntityId)
}

export function disconnectAllSockets() {
  for (const socket of medicSockets.values()) socket.disconnect()
  medicSockets.clear()
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function joinAsParticipant(
  eventId: string,
  entity: SimEntity,
  log: LogFn,
): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase}/api/auth/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        joinCode: eventId,
        name: entity.name,
        bibNumber: entity.bibNumber,
        role: 'runner',
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { token: string }
    log({ type: 'success', message: `[P] ${entity.name} joined (bib ${entity.bibNumber ?? '-'})` })
    return data.token
  } catch (err) {
    log({ type: 'error', message: `[P] ${entity.name} join failed: ${(err as Error).message}` })
    return null
  }
}

export async function joinAsMedic(
  eventId: string,
  entity: SimEntity,
  medicId: string,
  log: LogFn,
): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase}/api/auth/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ joinCode: eventId, medicId, role: 'medic' }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { token: string }
    log({ type: 'success', message: `[M] ${entity.name} joined as medic` })
    return data.token
  } catch (err) {
    log({ type: 'error', message: `[M] ${entity.name} medic join failed: ${(err as Error).message}` })
    return null
  }
}

// ─── Location sends ───────────────────────────────────────────────────────────

export function sendMedicLocation(entity: SimEntity, log: LogFn) {
  const socket = medicSockets.get(entity.id)
  if (!socket?.connected) return
  socket.emit('medic_location', {
    lat: entity.lat,
    lng: entity.lng,
    heading: entity.heading,
    speed: entity.speed,
    accuracy: 5,
  })
  log({ type: 'ws', message: `[M] ${entity.name} → (${entity.lat.toFixed(5)}, ${entity.lng.toFixed(5)})` })
}

export async function sendParticipantLocation(
  eventId: string,
  entity: SimEntity,
  log: LogFn,
) {
  if (!entity.token) return
  try {
    const res = await fetch(`${apiBase}/api/events/${eventId}/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${entity.token}`,
        'x-user-id': entity.id,
        'x-event-id': eventId,
        'x-role': 'runner',
      },
      body: JSON.stringify({
        lat: entity.lat,
        lng: entity.lng,
        accuracy: 10,
        timestamp: new Date().toISOString(),
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    log({ type: 'success', message: `[P] ${entity.name} → (${entity.lat.toFixed(5)}, ${entity.lng.toFixed(5)})` })
  } catch (err) {
    log({ type: 'error', message: `[P] ${entity.name} location failed: ${(err as Error).message}` })
  }
}

// ─── Incidents ────────────────────────────────────────────────────────────────

export async function createIncident(
  eventId: string,
  token: string,
  lat: number,
  lng: number,
  log: LogFn,
): Promise<void> {
  const res = await fetch(`${apiBase}/api/incidents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-event-id': eventId,
    },
    body: JSON.stringify({ lat, lng, timestamp: new Date().toISOString() }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json() as { id: string }
  log({ type: 'success', message: `[I] Incident created at (${lat.toFixed(5)}, ${lng.toFixed(5)}) id=${data.id.slice(0, 8)}` })
}

// ─── Tracks ───────────────────────────────────────────────────────────────────

export interface Track {
  id: string
  label: string
  color?: string
  points: Array<{ lat: number; lng: number }>
}

export async function fetchTracks(eventId: string): Promise<Track[]> {
  const res = await fetch(`${apiBase}/api/events/tracks`, {
    headers: { 'x-event-id': eventId },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ─── Medic roster ─────────────────────────────────────────────────────────────

export async function fetchMedicRoster(eventId: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${apiBase}/api/events/${eventId}/medics`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function addMedicToRoster(eventId: string, name: string): Promise<{ id: string; name: string }> {
  const res = await fetch(`${apiBase}/api/events/${eventId}/medics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
