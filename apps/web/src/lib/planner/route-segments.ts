/**
 * Splitting a drawn journey at its waypoints.
 *
 * A leg with two waypoints is drawn as one line but means an ORDER: start →
 * via 1 → via 2 → finish. Grab the stretch after via 1 and the new waypoint
 * belongs between via 1 and via 2 — not wherever a cheapest-insertion search
 * decides, which is free to reorder them and send the medic to via 2 first.
 *
 * So the line is cut at each waypoint and every piece carries the index a new
 * waypoint grabbed there should take. Where you take hold decides the order.
 */

import { haversineMeters } from './course'

export interface RouteSegment {
  path: [number, number][]
  /** Index in the leg's waypoint list that a grab here should insert at. */
  insertAt: number
}

export function splitRouteAtVias(
  path: [number, number][],
  via: Array<{ lat: number; lng: number }>,
): RouteSegment[] {
  if (path.length < 2) return []
  if (via.length === 0) return [{ path, insertAt: 0 }]

  // The vertex each waypoint snapped to, forced to run in order: the router
  // visits them in the order given, so the cuts cannot go backwards even if one
  // waypoint happens to sit near an earlier part of the line.
  const cuts: number[] = []
  let from = 1
  for (const point of via) {
    let best = from
    let bestDistance = Number.POSITIVE_INFINITY
    for (let i = from; i < path.length - 1; i += 1) {
      const d = haversineMeters(path[i], [point.lng, point.lat])
      if (d < bestDistance) {
        bestDistance = d
        best = i
      }
    }
    cuts.push(best)
    from = Math.max(from, best)
  }

  const segments: RouteSegment[] = []
  let start = 0
  cuts.forEach((cut, i) => {
    segments.push({ path: path.slice(start, cut + 1), insertAt: i })
    start = cut
  })
  segments.push({ path: path.slice(start), insertAt: cuts.length })
  return segments.filter(segment => segment.path.length >= 2)
}
