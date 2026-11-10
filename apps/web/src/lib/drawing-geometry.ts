/**
 * Geometry for hand-drawn map lines. Everything is `[lng, lat]` unless a
 * function says it works in screen pixels.
 *
 * A pointer trail is dense and shaky: hundreds of points a few pixels apart,
 * each one off by a pixel or two of hand tremor. Two passes turn it into a line
 * that looks meant: thin it to the vertices that carry the shape, then round
 * the corners that thinning leaves behind.
 */

export type LngLat = [number, number]
export type Px = [number, number]

const EARTH_RADIUS_M = 6_371_000
const RAD = Math.PI / 180

export function metersBetween(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD
  const dLng = (b[0] - a[0]) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function lineLengthMeters(line: LngLat[]): number {
  let total = 0
  for (let i = 1; i < line.length; i++) total += metersBetween(line[i - 1], line[i])
  return total
}

/** "840 m", "1.24 km", "12.6 km" — the precision a person reads at a glance. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 m'
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`
  if (meters < 10_000) return `${(meters / 1000).toFixed(2)} km`
  return `${(meters / 1000).toFixed(1)} km`
}

// ─── Thinning (Ramer–Douglas–Peucker, in screen space) ───────────────────────

function perpendicularDistance(p: Px, a: Px, b: Px): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/**
 * Indices of the points worth keeping. Works on pixels because "shaky" is a
 * property of the hand on the screen: a 3 px wobble is noise at any zoom, while
 * the same wobble in degrees is a hairpin at one zoom and nothing at another.
 */
export function simplifyIndices(points: Px[], tolerancePx: number): number[] {
  if (points.length <= 2) return points.map((_, i) => i)
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    let worst = 0
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(points[i], points[first], points[last])
      if (d > worst) {
        worst = d
        index = i
      }
    }
    if (index !== -1 && worst > tolerancePx) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  const out: number[] = []
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(i)
  return out
}

// ─── Smoothing (Chaikin corner cutting, open line) ───────────────────────────

/** One round of corner cutting that keeps both endpoints exactly where they are. */
function chaikinOpen(line: LngLat[]): LngLat[] {
  if (line.length < 3) return line
  const out: LngLat[] = [line[0]]
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]
    const b = line[i + 1]
    // The first and last segments keep their outer end — otherwise every pass
    // shortens the stroke and it stops meeting what it was drawn up to.
    if (i > 0) out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
    if (i < line.length - 2) out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
  }
  out.push(line[line.length - 1])
  return out
}

/**
 * Re-space a pointer trail to one sample every `stepPx` on screen. A mouse
 * reports by time, not distance, so a slow careful curve arrives as a dense
 * knot of points and a fast flick as a few far apart — and a filter that counts
 * samples would smooth the first to mush and leave the second untouched.
 */
function resampleByScreen(raw: LngLat[], px: Px[], stepPx: number): LngLat[] {
  const out: LngLat[] = [raw[0]]
  let carried = 0
  for (let i = 1; i < raw.length; i++) {
    const seg = Math.hypot(px[i][0] - px[i - 1][0], px[i][1] - px[i - 1][1])
    if (seg === 0) continue
    let at = stepPx - carried
    while (at <= seg) {
      const t = at / seg
      out.push([raw[i - 1][0] + (raw[i][0] - raw[i - 1][0]) * t, raw[i - 1][1] + (raw[i][1] - raw[i - 1][1]) * t])
      at += stepPx
    }
    carried = seg - (at - stepPx)
  }
  const last = raw[raw.length - 1]
  const tail = out[out.length - 1]
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last)
  return out
}

/**
 * Gaussian blur along the line. The window narrows towards each end, so both
 * endpoints stay exactly where the hand put them — a stroke drawn up to a road
 * junction still ends on it.
 */
function gaussianAlong(line: LngLat[], sigmaSamples: number): LngLat[] {
  const radius = Math.ceil(sigmaSamples * 3)
  const weights: number[] = []
  for (let j = 0; j <= radius; j++) weights.push(Math.exp(-(j * j) / (2 * sigmaSamples * sigmaSamples)))
  const last = line.length - 1
  return line.map((point, i) => {
    const reach = Math.min(radius, i, last - i)
    if (reach === 0) return point
    let lng = 0
    let lat = 0
    let total = 0
    for (let j = -reach; j <= reach; j++) {
      const w = weights[Math.abs(j)]
      lng += line[i + j][0] * w
      lat += line[i + j][1] * w
      total += w
    }
    return [lng / total, lat / total] as LngLat
  })
}

/**
 * Turn a raw pointer trail into a clean stroke.
 *
 * Three passes, each fixing what the previous one cannot:
 *   1. blur along the line — takes out hand tremor, which thinning alone keeps
 *      (a wobble bigger than the tolerance is a "corner" as far as it can tell);
 *   2. thin to the vertices that carry the shape, so a stroke is tens of points
 *      rather than hundreds;
 *   3. round the corners thinning leaves behind.
 *
 * `project` maps a coordinate to screen pixels at the zoom it was drawn at —
 * that is what makes every tolerance here mean the same thing however far the
 * map is zoomed. Returns `[]` when the trail is too short to be a line at all.
 */
export function smoothStroke(
  raw: LngLat[],
  project: (point: LngLat) => Px,
  opts: { smoothPx?: number; tolerancePx?: number; rounds?: number } = {},
): LngLat[] {
  if (raw.length < 2) return []
  const STEP_PX = 3
  const even = resampleByScreen(raw, raw.map(project), STEP_PX)
  if (even.length < 2) return []
  const calm = gaussianAlong(even, (opts.smoothPx ?? 7) / STEP_PX)
  const kept = simplifyIndices(calm.map(project), opts.tolerancePx ?? 1.2).map(i => calm[i])
  if (kept.length < 2) return []
  let line = kept
  for (let i = 0; i < (opts.rounds ?? 2); i++) line = chaikinOpen(line)
  return line
}

/** Total on-screen length of a pointer trail, to tell a stroke from a click. */
export function screenLength(points: Px[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  return total
}

// ─── Waypoints for snapping ──────────────────────────────────────────────────

/**
 * Evenly spaced waypoints along a stroke, for asking the routing engine to
 * follow it. Even spacing (rather than the shape-defining corners) is what
 * keeps the route on the SAME road as the sketch: between two corners 2 km
 * apart there are usually several ways through, and only the points along the
 * way say which one was meant.
 */
export function waypointsAlong(line: LngLat[], maxPoints = 14, minSpacingM = 120): LngLat[] {
  if (line.length <= 2) return line
  const total = lineLengthMeters(line)
  if (total === 0) return [line[0], line[line.length - 1]]
  const count = Math.max(2, Math.min(maxPoints, Math.floor(total / minSpacingM) + 1))
  const step = total / (count - 1)
  const out: LngLat[] = [line[0]]
  let travelled = 0
  let next = step
  for (let i = 1; i < line.length && out.length < count - 1; i++) {
    const seg = metersBetween(line[i - 1], line[i])
    while (seg > 0 && travelled + seg >= next && out.length < count - 1) {
      const t = (next - travelled) / seg
      out.push([line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t])
      next += step
    }
    travelled += seg
  }
  out.push(line[line.length - 1])
  return out
}

// ─── Labels and framing ──────────────────────────────────────────────────────

/** The point halfway along a line — where its label sits. */
export function midpointAlong(line: LngLat[]): LngLat {
  if (line.length === 0) return [0, 0]
  if (line.length === 1) return line[0]
  const half = lineLengthMeters(line) / 2
  let travelled = 0
  for (let i = 1; i < line.length; i++) {
    const seg = metersBetween(line[i - 1], line[i])
    if (travelled + seg >= half && seg > 0) {
      const t = (half - travelled) / seg
      return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]
    }
    travelled += seg
  }
  return line[line.length - 1]
}

/** The longest stroke of a drawing — the one its label belongs to. */
export function longestLine(lines: LngLat[][]): LngLat[] {
  let best: LngLat[] = lines[0] ?? []
  let bestLength = -1
  for (const line of lines) {
    const length = lineLengthMeters(line)
    if (length > bestLength) {
      best = line
      bestLength = length
    }
  }
  return best
}

export function boundsOf(lines: LngLat[][]): [[number, number], [number, number]] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const line of lines) {
    for (const [lng, lat] of line) {
      if (lng < w) w = lng
      if (lng > e) e = lng
      if (lat < s) s = lat
      if (lat > n) n = lat
    }
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null
}
