const env = import.meta.env;

export const apiUrl = env.VITE_API_URL || env.EXPO_PUBLIC_API_URL || "http://localhost:4000/api";
export const wsUrl = env.VITE_WS_URL || env.EXPO_PUBLIC_WS_URL || "http://localhost:4000/realtime";
export const mapyApiKey = env.VITE_MAPY_API_KEY || env.EXPO_PUBLIC_MAPY_API_KEY || "";
export const useMapyTiles = (env.VITE_USE_MAPY_TILES || env.EXPO_PUBLIC_USE_MAPY_TILES) === "true";

export function getMapyTilesTemplateUrl(): string | null {
  if (!useMapyTiles || !mapyApiKey) {
    return null;
  }

  return `https://api.mapy.cz/v1/maptiles/outdoor/256@2x/{z}/{x}/{y}?apikey=${encodeURIComponent(mapyApiKey)}`;
}
