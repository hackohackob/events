// API + WS communication with the backend

import { io, Socket } from 'socket.io-client'
import { jitterPoint, type SimEntity, type MedicStatus } from './simulation'

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

function medicFix(entity: SimEntity) {
  const j = jitterPoint(entity.lat, entity.lng, entity.jitterM ?? 0)
  return {
    lat: j.lat,
    lng: j.lng,
    heading: entity.heading,
    speed: entity.speed,
    accuracy: entity.accuracy ?? 5,
  }
}

/** Send a medic fix over the chosen channel (ws or http), honouring offline/jitter/accuracy. */
export function sendMedicLocation(entity: SimEntity, eventId: string, log: LogFn) {
  if (entity.offline) return
  if ((entity.sendChannel ?? 'ws') === 'http') {
    void sendMedicLocationHttp(entity, eventId, log)
    return
  }
  const socket = medicSockets.get(entity.id)
  if (!socket?.connected) return
  socket.emit('medic_location', medicFix(entity))
  log({ type: 'ws', message: `[M] ${entity.name} → (${entity.lat.toFixed(5)}, ${entity.lng.toFixed(5)}) ±${entity.accuracy ?? 5}m` })
}

async function sendMedicLocationHttp(entity: SimEntity, eventId: string, log: LogFn) {
  if (!entity.medicId) return
  try {
    const res = await fetch(`${apiBase}/api/events/${eventId}/medics/${entity.medicId}/location`, {
      method: 'POST',
      headers: medicHeaders(eventId, entity),
      body: JSON.stringify(medicFix(entity)),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    log({ type: 'success', message: `[M·http] ${entity.name} → (${entity.lat.toFixed(5)}, ${entity.lng.toFixed(5)}) ±${entity.accuracy ?? 5}m` })
  } catch (err) {
    log({ type: 'error', message: `[M·http] ${entity.name} location failed: ${(err as Error).message}` })
  }
}

// ─── Per-medic actions (REST) ──────────────────────────────────────────────────

function medicHeaders(eventId: string, entity: SimEntity): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(entity.token ? { Authorization: `Bearer ${entity.token}` } : {}),
    'x-user-id': entity.medicId ?? entity.id,
    'x-event-id': eventId,
    'x-role': 'medic',
  }
}

export interface SimIncident {
  id: string
  name?: string
  lat: number
  lng: number
  type: string
  status: string
}

/** List incidents for the event (used to route a medic to one). */
export async function fetchIncidents(eventId: string): Promise<SimIncident[]> {
  const res = await fetch(`${apiBase}/api/incidents`, {
    headers: { 'x-event-id': eventId, 'x-user-id': 'sim', 'x-role': 'coordinator' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Set a medic's destination ("going to"), or pass null to clear. */
export async function assignMedicDestination(
  eventId: string,
  entity: SimEntity,
  destination: { lat: number; lng: number; label: string } | null,
  log: LogFn,
) {
  if (!entity.medicId) return
  try {
    const res = await fetch(`${apiBase}/api/events/${eventId}/medics/${entity.medicId}/assign`, {
      method: 'PATCH',
      headers: medicHeaders(eventId, entity),
      body: JSON.stringify({ destination }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    log({ type: 'success', message: destination ? `[M] ${entity.name} → going to ${destination.label}` : `[M] ${entity.name} cleared destination` })
  } catch (err) {
    log({ type: 'error', message: `[M] ${entity.name} assign failed: ${(err as Error).message}` })
  }
}

export interface SimRouteSegment { surface: 'road' | 'offroad' | 'path'; coordinates: [number, number][] }
export interface SimMedicRoute {
  geometry: [number, number][]
  segments: SimRouteSegment[]
  distanceMeters: number
  durationMs: number
  etaIso?: string
  incidentId?: string | null
}

/**
 * Fetch a real road route between two points from the backend GraphHopper proxy,
 * so a simulated medic navigates legitimately (follows roads) instead of flying
 * in a straight line. Returns the full route (geometry + colour segments + ETA),
 * or null on failure (caller should fall back to a straight line).
 */
export async function fetchMedicRoute(
  eventId: string,
  entity: SimEntity,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  profile: 'car' | 'foot' | 'mtb' | 'rescue_4x4',
  log: LogFn,
): Promise<SimMedicRoute | null> {
  try {
    const res = await fetch(`${apiBase}/api/routing/route`, {
      method: 'POST',
      headers: medicHeaders(eventId, entity),
      body: JSON.stringify({
        profile,
        points: [[from.lng, from.lat], [to.lng, to.lat]],
        alternatives: 1,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as {
      routes?: Array<{ geometry: [number, number][]; segments: SimRouteSegment[]; distanceMeters: number; durationMs: number }>
    }
    const r = data.routes?.[0]
    if (!r || !r.geometry || r.geometry.length < 2) return null
    log({ type: 'info', message: `[M] ${entity.name} routed (${r.geometry.length} pts, ${profile})` })
    return {
      geometry: r.geometry,
      segments: r.segments ?? [],
      distanceMeters: r.distanceMeters,
      durationMs: r.durationMs,
      etaIso: new Date(Date.now() + r.durationMs).toISOString(),
    }
  } catch (err) {
    log({ type: 'error', message: `[M] ${entity.name} route failed: ${(err as Error).message}` })
    return null
  }
}

/** Broadcast (or clear) a medic's active navigation path to the whole team + dashboard. */
export async function setMedicRoute(
  eventId: string,
  entity: SimEntity,
  route: SimMedicRoute | null,
  destination: { lat: number; lng: number; label: string } | null,
  log: LogFn,
) {
  if (!entity.medicId) return
  try {
    const res = await fetch(`${apiBase}/api/events/${eventId}/medics/${entity.medicId}/route`, {
      method: 'PATCH',
      headers: medicHeaders(eventId, entity),
      body: JSON.stringify({ route, destination }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    log({ type: 'error', message: `[M] ${entity.name} set route failed: ${(err as Error).message}` })
  }
}

/** Set a medic's status (available | rest | going_to). */
export async function setMedicStatus(eventId: string, entity: SimEntity, status: MedicStatus, log: LogFn) {
  if (!entity.medicId) return
  try {
    const res = await fetch(`${apiBase}/api/events/${eventId}/medics/${entity.medicId}/status`, {
      method: 'PATCH',
      headers: medicHeaders(eventId, entity),
      body: JSON.stringify({ status }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    log({ type: 'success', message: `[M] ${entity.name} status → ${status}` })
  } catch (err) {
    log({ type: 'error', message: `[M] ${entity.name} status failed: ${(err as Error).message}` })
  }
}

/** Register the medic as responding ("going") to an incident. */
export async function respondToIncident(eventId: string, incidentId: string, entity: SimEntity, log: LogFn) {
  if (!entity.medicId) return
  try {
    const res = await fetch(`${apiBase}/api/incidents/${incidentId}/action`, {
      method: 'PATCH',
      headers: medicHeaders(eventId, entity),
      body: JSON.stringify({ action: 'going' }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    log({ type: 'success', message: `[I] ${entity.name} responding to incident` })
  } catch (err) {
    log({ type: 'error', message: `[I] ${entity.name} respond failed: ${(err as Error).message}` })
  }
}

/** Send an incident chat message as the medic. */
export async function sendIncidentMessage(eventId: string, incidentId: string, entity: SimEntity, text: string, log: LogFn) {
  try {
    const res = await fetch(`${apiBase}/api/incidents/${incidentId}/messages`, {
      method: 'POST',
      headers: medicHeaders(eventId, entity),
      body: JSON.stringify({ text }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    log({ type: 'success', message: `[I] ${entity.name}: "${text}"` })
  } catch (err) {
    log({ type: 'error', message: `[I] ${entity.name} message failed: ${(err as Error).message}` })
  }
}

/** Create an incident reported by this medic at the given location. Returns the new id. */
export async function createIncidentAsMedic(
  eventId: string,
  entity: SimEntity,
  lat: number,
  lng: number,
  details: { type?: string; severity?: string; description?: string },
  log: LogFn,
): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase}/api/incidents`, {
      method: 'POST',
      headers: medicHeaders(eventId, entity),
      body: JSON.stringify({ lat, lng, timestamp: new Date().toISOString() }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { id: string; name?: string }
    // Apply optional details in a follow-up PATCH.
    if (details.type || details.severity || details.description) {
      await fetch(`${apiBase}/api/incidents/${data.id}`, {
        method: 'PATCH',
        headers: medicHeaders(eventId, entity),
        body: JSON.stringify({ type: details.type, severity: details.severity, description: details.description }),
      }).catch(() => {})
    }
    log({ type: 'success', message: `[I] ${entity.name} reported ${data.name ?? 'incident'}` })
    return data.id
  } catch (err) {
    log({ type: 'error', message: `[I] ${entity.name} report failed: ${(err as Error).message}` })
    return null
  }
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
