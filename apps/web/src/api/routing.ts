import client from "./client";

export interface AsphaltAccessPoint {
  lat: number;
  lng: number;
  /** On-foot distance from the incident, metres. */
  distanceMeters: number;
  /** On-foot travel time from the incident, ms. */
  durationMs: number;
  roadHint?: string;
}

/** Nearest paved-road access points around a location (e.g. an incident). */
export async function closestAsphalt(lat: number, lng: number): Promise<AsphaltAccessPoint[]> {
  const res = await client.post<{ points: AsphaltAccessPoint[] }>("/routing/closest-asphalt", { lat, lng });
  return res.data.points;
}
