/**
 * How long it takes a medic to relocate.
 *
 * Two tiers: a crow-flies estimate that is always available and good enough to
 * keep the timeline honest while you drag things around, and a real routed
 * measurement fetched in the background that replaces it once it lands.
 */

import type { VehicleType } from '@events/contracts'

/** Sustainable relocation speed per vehicle, km/h — not a sprint to an incident. */
const VEHICLE_SPEED_KMH: Record<VehicleType, number> = {
  foot: 4.2,
  bike: 12,
  'e-bike': 15,
  'e-motorcycle': 24,
  motorcycle: 30,
  atv: 20,
  car: 45,
  'offroad-car': 32,
  ambulance: 45,
  'offroad-ambulance': 32,
}

/** Roads are never straight. Mountain events are worse than most. */
const DETOUR_FACTOR = 1.4

/** Routing profile each vehicle is quoted on — mirrors the backend's mapping. */
export function routeProfileFor(vehicle: VehicleType): 'foot' | 'mtb' | 'car' | 'rescue_4x4' {
  switch (vehicle) {
    case 'foot':
      return 'foot'
    case 'bike':
    case 'e-bike':
      return 'mtb'
    case 'car':
    case 'ambulance':
      return 'car'
    default:
      return 'rescue_4x4'
  }
}

/** Crow-flies minutes, detoured and rounded up to the nearest 5. */
export function estimateTravelMinutes(meters: number, vehicle: VehicleType): number {
  const kmh = VEHICLE_SPEED_KMH[vehicle] ?? VEHICLE_SPEED_KMH.foot
  const minutes = ((meters / 1000) * DETOUR_FACTOR / kmh) * 60
  return Math.ceil(minutes / 5) * 5
}

export function vehicleSpeedKmh(vehicle: VehicleType): number {
  return VEHICLE_SPEED_KMH[vehicle] ?? VEHICLE_SPEED_KMH.foot
}
