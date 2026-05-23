// Next.js statically inlines NEXT_PUBLIC_* only when accessed as literals at build time.
// Dynamic process.env[key] lookups resolve to undefined in the client bundle.
export const apiUrl =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8500/api'
export const wsUrl =
  process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:8500/realtime'
export const mapyApiKey = process.env.NEXT_PUBLIC_MAPY_API_KEY || ''
export const useMapyTiles = process.env.NEXT_PUBLIC_USE_MAPY_TILES === 'true'

export function getMapyTilesTemplateUrl(): string | null {
  if (!useMapyTiles || !mapyApiKey) return null
  return `https://api.mapy.cz/v1/maptiles/outdoor/256@2x/{z}/{x}/{y}?apikey=${encodeURIComponent(mapyApiKey)}`
}
