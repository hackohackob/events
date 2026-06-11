import { apiUrl } from '@/env'

/** Resolve a possibly-relative GPX URL to an absolute one using the backend base. */
function resolveGpxUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  // apiUrl is like "http://localhost:8500/api" — strip the /api suffix for file serving
  const base = apiUrl.replace(/\/api$/, '')
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`
}

/** Parse a GPX file text → list of [lng, lat] coordinates */
export function parseGpxCoordinates(text: string): [number, number][] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'application/xml')
  const trkpts = Array.from(doc.querySelectorAll('trkpt'))
  if (trkpts.length > 0) {
    return trkpts
      .map(pt => {
        const lat = parseFloat(pt.getAttribute('lat') ?? '')
        const lon = parseFloat(pt.getAttribute('lon') ?? '')
        return isFinite(lat) && isFinite(lon) ? ([lon, lat] as [number, number]) : null
      })
      .filter((c): c is [number, number] => c !== null)
  }
  // Fall back to <wpt> or <rtept>
  return Array.from(doc.querySelectorAll('wpt, rtept'))
    .map(pt => {
      const lat = parseFloat(pt.getAttribute('lat') ?? '')
      const lon = parseFloat(pt.getAttribute('lon') ?? '')
      return isFinite(lat) && isFinite(lon) ? ([lon, lat] as [number, number]) : null
    })
    .filter((c): c is [number, number] => c !== null)
}

/** Fetch a GPX URL and return its coordinates (returns [] on failure) */
export async function fetchGpxCoordinates(url: string): Promise<[number, number][]> {
  try {
    const res = await fetch(resolveGpxUrl(url))
    if (!res.ok) return []
    const text = await res.text()
    return parseGpxCoordinates(text)
  } catch {
    return []
  }
}

export interface GpxTrack {
  coordinates: [number, number][]
  /** Near-raw elevation profile (distance km → elevation m); empty when the GPX has no elevation. */
  elevationProfile: { distance: number; elevation: number }[]
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(h))
}

/**
 * Parse a GPX file into coordinates + a near-raw elevation profile. Mirrors the
 * parser used when uploading a GPX in the Disciplines step so an event loaded
 * for editing produces the same elevation profile it had on creation.
 */
export function parseGpxTrack(text: string): GpxTrack {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(text, 'application/xml')
    const trkpts = Array.from(doc.querySelectorAll('trkpt'))
    if (trkpts.length === 0) {
      return { coordinates: parseGpxCoordinates(text), elevationProfile: [] }
    }

    const coordinates: [number, number][] = trkpts.map(pt => [
      parseFloat(pt.getAttribute('lon') || '0'),
      parseFloat(pt.getAttribute('lat') || '0'),
    ])

    const cumDist: number[] = [0]
    for (let i = 1; i < coordinates.length; i++) {
      cumDist[i] = cumDist[i - 1] + haversineKm(coordinates[i - 1], coordinates[i])
    }

    const eles = trkpts.map(pt => parseFloat(pt.querySelector('ele')?.textContent || '0'))
    const hasElevation = eles.some(e => e > 0)
    const elevationProfile: { distance: number; elevation: number }[] = []
    if (hasElevation) {
      // Light 3-point smoothing to take the edge off GPS noise; capped to keep
      // the chart responsive on huge tracks.
      const smoothed = eles.map((e, i) =>
        i === 0 || i === eles.length - 1 ? e : (eles[i - 1] + e + eles[i + 1]) / 3,
      )
      const MAX_POINTS = 800
      const stride = smoothed.length > MAX_POINTS ? Math.ceil(smoothed.length / MAX_POINTS) : 1
      for (let i = 0; i < smoothed.length; i += stride) {
        elevationProfile.push({ distance: Math.round(cumDist[i] * 100) / 100, elevation: Math.round(smoothed[i]) })
      }
      const lastIdx = smoothed.length - 1
      if (elevationProfile[elevationProfile.length - 1]?.distance !== Math.round(cumDist[lastIdx] * 100) / 100) {
        elevationProfile.push({ distance: Math.round(cumDist[lastIdx] * 100) / 100, elevation: Math.round(smoothed[lastIdx]) })
      }
    }

    return { coordinates, elevationProfile }
  } catch {
    return { coordinates: [], elevationProfile: [] }
  }
}

/** Fetch a GPX URL and return coordinates + elevation profile (empty on failure). */
export async function fetchGpxTrack(url: string): Promise<GpxTrack> {
  try {
    const res = await fetch(resolveGpxUrl(url))
    if (!res.ok) return { coordinates: [], elevationProfile: [] }
    return parseGpxTrack(await res.text())
  } catch {
    return { coordinates: [], elevationProfile: [] }
  }
}
