// Works in both Next.js (process.env.NEXT_PUBLIC_*) and Vite (import.meta.env.VITE_*)
function getEnv(key: string, fallback = ''): string {
  if (typeof process !== 'undefined' && process.env) {
    const nextKey = key.replace(/^VITE_/, 'NEXT_PUBLIC_').replace(/^EXPO_PUBLIC_/, 'NEXT_PUBLIC_')
    if (process.env[nextKey]) return process.env[nextKey]!
    if (process.env[key]) return process.env[key]!
  }
  // Vite runtime (non-Next.js builds)
  try {
    const meta = (import.meta as any)?.env
    if (meta && meta[key]) return meta[key]
  } catch {
    // not available
  }
  return fallback
}

export const apiUrl = getEnv('VITE_API_URL', 'http://localhost:8500/api')
export const wsUrl = getEnv('VITE_WS_URL', 'http://localhost:8500/realtime')
export const mapyApiKey = getEnv('VITE_MAPY_API_KEY', '')
export const useMapyTiles = getEnv('VITE_USE_MAPY_TILES') === 'true'

export function getMapyTilesTemplateUrl(): string | null {
  if (!useMapyTiles || !mapyApiKey) return null
  return `https://api.mapy.cz/v1/maptiles/outdoor/256@2x/{z}/{x}/{y}?apikey=${encodeURIComponent(mapyApiKey)}`
}
