const mapyApiKey = process.env.EXPO_PUBLIC_MAPY_API_KEY || process.env.MAPY_API_KEY || "";

export function getMapyApiKey(): string {
  return mapyApiKey;
}

export function getMapyTilesTemplateUrl(): string | null {
  if (!mapyApiKey) {
    return null;
  }

  return `https://api.mapy.cz/v1/maptiles/outdoor/256@2x/{z}/{x}/{y}?apikey=${encodeURIComponent(mapyApiKey)}`;
}
