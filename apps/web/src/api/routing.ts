import client from "./client";

export interface AsphaltAccessPoint {
  /** 1-based exit number — routed points first (fastest first), then direct. */
  index: number;
  lat: number;
  lng: number;
  roadHint?: string;
  /** Incident → point leg. `direct` = no walkable route; straight distance, no time. */
  incident: { distanceMeters: number; durationMs?: number; direct: boolean };
  /** Caller → point by car (when a caller position was sent). */
  fromMe?: { distanceMeters: number; durationMs: number };
}

/** Nearest paved-road access points around a location (e.g. an incident). */
export async function closestAsphalt(lat: number, lng: number): Promise<AsphaltAccessPoint[]> {
  const res = await client.post<{ points: AsphaltAccessPoint[] }>("/routing/closest-asphalt", { lat, lng });
  return res.data.points;
}
