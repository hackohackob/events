// Simulation engine: manages entities and their movement

export type EntityRole = 'medic' | 'participant'

export interface RoutePoint {
  lat: number
  lng: number
}

export type RouteMode = 'loop' | 'pingpong' | 'once'
export type MedicStatus = 'available' | 'rest' | 'going_to'
export type SendChannel = 'ws' | 'http'

export interface SimEntity {
  id: string
  role: EntityRole
  name: string
  bibNumber?: string
  lat: number
  lng: number
  speed: number        // m/s
  heading: number      // degrees
  token?: string       // auth token once joined
  medicId?: string     // roster id (event_medics.id) for REST calls
  joined: boolean
  color: string
  // Route-following fields
  routePoints?: RoutePoint[]   // ordered waypoints
  routeIndex?: number          // current waypoint index (integer)
  routeLoop?: boolean          // legacy: restart from start when end is reached
  routeMode?: RouteMode        // loop | pingpong | once
  routeDir?: 1 | -1            // travel direction along the route
  routeVariance?: number       // meters of Gaussian noise to add (for medics)
  routeLabel?: string          // human label of the active route/destination
  // Per-medic controls
  accuracy?: number            // reported GPS accuracy (m)
  jitterM?: number             // continuous GPS noise added to every sent fix (m)
  paused?: boolean             // frozen in place
  offline?: boolean            // joined but intentionally not sending
  sendChannel?: SendChannel    // medic transport (ws | http)
  status?: MedicStatus         // live medic status
  assignedIncidentId?: string  // incident this medic is responding to
}

// Sofia city center + trails
const CENTER = { lat: 42.6977, lng: 23.3219 }
const SPREAD = 0.025 // ~2.5km

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function randomNearby(): { lat: number; lng: number } {
  return {
    lat: CENTER.lat + rand(-SPREAD, SPREAD),
    lng: CENTER.lng + rand(-SPREAD, SPREAD),
  }
}

const MEDIC_COLORS = ['#22c55e', '#10b981', '#34d399', '#4ade80', '#6ee7b7']
const PARTICIPANT_COLORS = ['#3b82f6', '#60a5fa', '#93c5fd', '#6366f1', '#818cf8']

function randomName(role: EntityRole, index: number): string {
  const medicNames = [
    'Dr. Georgi P.', 'Dr. Maria K.', 'Nurse Ivan T.', 'Paramedic Ana S.',
    'Dr. Peter V.', 'Nurse Elena D.', 'Dr. Nikola R.', 'Paramedic Sofia B.',
  ]
  const runnerNames = [
    'Aleksei M.', 'Vanya P.', 'Boyan K.', 'Tsveta L.', 'Dimitar N.',
    'Rosen A.', 'Kristina V.', 'Plamen H.', 'Denica S.', 'Hristo C.',
  ]
  if (role === 'medic') return medicNames[index % medicNames.length]
  return runnerNames[index % runnerNames.length]
}

export function createMedic(index: number, name?: string): SimEntity {
  const pos = randomNearby()
  return {
    id: `sim-medic-${Date.now()}-${index}`,
    role: 'medic',
    name: name ?? randomName('medic', index),
    lat: pos.lat,
    lng: pos.lng,
    speed: rand(0.5, 2.0),
    heading: rand(0, 360),
    joined: false,
    color: MEDIC_COLORS[index % MEDIC_COLORS.length],
    accuracy: 5,
    jitterM: 0,
    paused: false,
    offline: false,
    sendChannel: 'ws',
    status: 'available',
  }
}

export function createParticipant(index: number): SimEntity {
  const pos = randomNearby()
  const bib = String(index + 1).padStart(3, '0')
  return {
    id: `sim-runner-${Date.now()}-${index}`,
    role: 'participant',
    name: randomName('participant', index),
    bibNumber: bib,
    lat: pos.lat,
    lng: pos.lng,
    speed: rand(1.5, 4.0),
    heading: rand(0, 360),
    joined: false,
    color: PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length],
  }
}

/** Haversine distance in meters between two lat/lng points */
function distanceMeters(a: RoutePoint, b: RoutePoint): number {
  const R = 6_371_000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const c = sinDLat * sinDLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinDLng * sinDLng
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c))
}

/** Bearing from point a to point b in degrees */
function bearing(a: RoutePoint, b: RoutePoint): number {
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

/**
 * Box-Muller transform — returns a standard-normal random number.
 * We call rand() twice for the two uniforms, which is fine for simulation noise.
 */
function gaussianNoise(): number {
  const u1 = Math.max(1e-10, Math.random())
  const u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** Offset a point by `meters` of Gaussian noise — used for reported GPS jitter. */
export function jitterPoint(lat: number, lng: number, meters: number): { lat: number; lng: number } {
  if (!meters || meters <= 0) return { lat, lng }
  const noiseDeg = meters / 111_320
  const nLat = lat + gaussianNoise() * noiseDeg
  const nLng = lng + (gaussianNoise() * noiseDeg) / Math.cos(lat * Math.PI / 180)
  return { lat: nLat, lng: nLng }
}

/** Move entity by one tick (seconds), following a route if assigned, else random walk */
export function stepEntity(entity: SimEntity, deltaSec: number, speedMultiplier: number): SimEntity {
  // Frozen entities don't move at all.
  if (entity.paused) return entity

  const dist = entity.speed * speedMultiplier * deltaSec

  // ── Route-following mode ────────────────────────────────────────────────────
  if (entity.routePoints && entity.routePoints.length >= 2) {
    const points = entity.routePoints
    const lastIdx = points.length - 1
    const mode: RouteMode = entity.routeMode ?? (entity.routeLoop ? 'loop' : 'once')
    let idx = entity.routeIndex ?? 0
    let dir: 1 | -1 = entity.routeDir ?? 1

    // Determine the next waypoint to head toward based on direction.
    let nextIdx = idx + dir
    // Handle reaching an edge.
    if (nextIdx < 0 || nextIdx > lastIdx) {
      if (mode === 'once') {
        return { ...entity, status: entity.status }
      } else if (mode === 'loop') {
        idx = dir > 0 ? 0 : lastIdx
        nextIdx = idx + dir
      } else {
        // pingpong — flip direction
        dir = (dir * -1) as 1 | -1
        nextIdx = idx + dir
      }
      if (nextIdx < 0 || nextIdx > lastIdx) return entity // degenerate (single point)
    }

    const waypoint = points[nextIdx]
    const current: RoutePoint = { lat: entity.lat, lng: entity.lng }
    const dToWaypoint = distanceMeters(current, waypoint)
    const newHeading = bearing(current, waypoint)

    let lat: number
    let lng: number
    let newIdx = idx

    if (dToWaypoint <= 5 || dToWaypoint <= dist) {
      lat = waypoint.lat
      lng = waypoint.lng
      newIdx = nextIdx
    } else {
      lat = entity.lat + (dist / 111_320) * Math.cos(newHeading * Math.PI / 180)
      lng = entity.lng + dist / (111_320 * Math.cos(entity.lat * Math.PI / 180)) * Math.sin(newHeading * Math.PI / 180)
    }

    // Gaussian path noise (e.g. medics patrolling a track).
    if (entity.routeVariance && entity.routeVariance > 0) {
      const noiseDeg = entity.routeVariance / 111_320
      lat += gaussianNoise() * noiseDeg
      lng += gaussianNoise() * noiseDeg / Math.cos(lat * Math.PI / 180)
    }

    return { ...entity, lat, lng, heading: newHeading, routeIndex: newIdx, routeDir: dir }
  }

  // ── Random-walk mode ────────────────────────────────────────────────────────
  const turn = rand(-15, 15)
  const newHeading = (entity.heading + turn + 360) % 360

  // Convert dist (m) to degrees (approx)
  const dLat = (dist / 111_320) * Math.cos((newHeading * Math.PI) / 180)
  const dLng = dist / (111_320 * Math.cos((entity.lat * Math.PI) / 180)) * Math.sin((newHeading * Math.PI) / 180)

  let lat = entity.lat + dLat
  let lng = entity.lng + dLng

  // Bounce back if too far from center
  const latDiff = lat - CENTER.lat
  const lngDiff = lng - CENTER.lng
  let heading = newHeading
  if (Math.abs(latDiff) > SPREAD * 1.2 || Math.abs(lngDiff) > SPREAD * 1.2) {
    heading = (Math.atan2(-lngDiff, -latDiff) * 180 / Math.PI + 360) % 360
    lat = entity.lat
    lng = entity.lng
  }

  return { ...entity, lat, lng, heading }
}
