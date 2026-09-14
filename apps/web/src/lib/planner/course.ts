/**
 * A race course, pre-measured so the planner can answer "where is the field
 * right now?" thousands of times a second while the timeline plays.
 *
 * Two measurements are kept per vertex: real distance, and *effort* distance.
 * Effort weights every segment by its gradient, because that is the whole point
 * of the exercise — on a mountain course the pack spends a third of its time in
 * a tenth of the distance, and a planner that walks runners along at a constant
 * km/h puts the medics in the wrong valley.
 */

export interface CourseModel {
  /** `[lng, lat]` vertices, as drawn on the map. */
  coordinates: [number, number][]
  /** Cumulative metres at each vertex (`cumulative[0] === 0`). */
  cumulative: number[]
  /** Cumulative gradient-weighted metres at each vertex. */
  effort: number[]
  totalMeters: number
  totalEffort: number
  /** True when the GPX carried usable elevation, i.e. terrain pacing is real. */
  hasElevation: boolean
  ascentMeters: number
}

const EARTH_RADIUS_M = 6371000

export function haversineMeters(a: [number, number], b: [number, number]): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Time cost of a metre at gradient `g` (rise/run), relative to the flat.
 *
 * A tamed Minetti curve: steeply super-linear uphill, mildly faster on a gentle
 * descent, and slower again once the descent gets technical enough that people
 * brake. Clamped at both ends so a single noisy GPS vertex on a cliff edge
 * cannot swallow the whole course's effort budget.
 */
export function gradeCost(g: number): number {
  const grade = Math.max(-0.45, Math.min(0.45, g))
  if (grade >= 0) return 1 + 7.2 * grade
  if (grade >= -0.12) return 1 + 1.6 * grade // down to ~0.81 at -12%
  return 0.808 - 2.4 * (grade + 0.12) // braking territory: slows back down
}

/** Build the measured model. `elevations` may be empty (→ distance pacing). */
export function buildCourse(
  coordinates: [number, number][],
  elevations: number[] = [],
): CourseModel {
  const n = coordinates.length
  const cumulative = new Array<number>(n).fill(0)
  const effort = new Array<number>(n).fill(0)
  const hasElevation = elevations.length === n && elevations.some(e => Number.isFinite(e) && e !== 0)
  let ascent = 0

  for (let i = 1; i < n; i += 1) {
    const d = haversineMeters(coordinates[i - 1], coordinates[i])
    cumulative[i] = cumulative[i - 1] + d
    let cost = 1
    if (hasElevation && d > 0.5) {
      const rise = elevations[i] - elevations[i - 1]
      if (rise > 0) ascent += rise
      cost = gradeCost(rise / d)
    }
    effort[i] = effort[i - 1] + d * cost
  }

  return {
    coordinates,
    cumulative,
    effort,
    totalMeters: cumulative[n - 1] ?? 0,
    totalEffort: effort[n - 1] ?? 0,
    hasElevation,
    ascentMeters: Math.round(ascent),
  }
}

/** Binary search: largest index whose value is ≤ `target`. */
function lowerBound(values: number[], target: number): number {
  let lo = 0
  let hi = values.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (values[mid] <= target) lo = mid
    else hi = mid - 1
  }
  return lo
}

function lerpPoint(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** The point `meters` along the course, interpolated inside the segment. */
export function pointAtMeters(course: CourseModel, meters: number): [number, number] {
  const { coordinates, cumulative } = course
  if (coordinates.length === 0) return [0, 0]
  if (meters <= 0) return coordinates[0]
  if (meters >= course.totalMeters) return coordinates[coordinates.length - 1]
  const i = lowerBound(cumulative, meters)
  const next = Math.min(i + 1, coordinates.length - 1)
  const span = cumulative[next] - cumulative[i]
  const t = span > 0 ? (meters - cumulative[i]) / span : 0
  return lerpPoint(coordinates[i], coordinates[next], t)
}

/**
 * How far along the course a runner is after burning `fraction` of their total
 * race time. With terrain pacing this is the distance at which the *effort*
 * spent matches that fraction — the pack genuinely crawls up the climbs.
 */
export function metersAtTimeFraction(
  course: CourseModel,
  fraction: number,
  terrain: boolean,
): number {
  const f = Math.max(0, Math.min(1, fraction))
  if (!terrain || !course.hasElevation || course.totalEffort <= 0) return course.totalMeters * f
  const targetEffort = course.totalEffort * f
  const i = lowerBound(course.effort, targetEffort)
  const next = Math.min(i + 1, course.effort.length - 1)
  const span = course.effort[next] - course.effort[i]
  const t = span > 0 ? (targetEffort - course.effort[i]) / span : 0
  return course.cumulative[i] + (course.cumulative[next] - course.cumulative[i]) * t
}

/** Nearest point on the course to a coordinate — used for "km 43.2" readouts. */
export function nearestOnCourse(
  course: CourseModel,
  point: [number, number],
): { meters: number; distanceMeters: number } {
  let best = { meters: 0, distanceMeters: Number.POSITIVE_INFINITY }
  // Vertex-level resolution is plenty: a 160 km GPX still lands inside ~20 m.
  for (let i = 0; i < course.coordinates.length; i += 1) {
    const d = haversineMeters(course.coordinates[i], point)
    if (d < best.distanceMeters) best = { meters: course.cumulative[i], distanceMeters: d }
  }
  return best
}
