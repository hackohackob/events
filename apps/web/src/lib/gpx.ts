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
