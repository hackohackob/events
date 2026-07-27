import client from "./client";

export interface AsphaltAccessPoint {
  /** 1-based exit number — routed points first (fastest first), then direct. */
  index: number;
  lat: number;
  lng: number;
  roadHint?: string;
  /** Incident → point leg. `direct` = drawn as a straight line (distance is
   *  crow-flies); `noRoad` marks the ones with no walkable route at all. */
  incident: { distanceMeters: number; durationMs?: number; direct: boolean; noRoad?: boolean };
  /** Walk path from the incident (routed points only). */
  path?: { geometry: Array<[number, number]>; elevations?: number[]; ascentMeters?: number; descentMeters?: number };
  /** Caller → point by car (when a caller position was sent). */
  fromMe?: { distanceMeters: number; durationMs: number };
}

/** Nearest paved-road access points around a location (e.g. an incident). */
export async function closestAsphalt(lat: number, lng: number): Promise<AsphaltAccessPoint[]> {
  const res = await client.post<{ points: AsphaltAccessPoint[] }>("/routing/closest-asphalt", { lat, lng });
  return res.data.points;
}
