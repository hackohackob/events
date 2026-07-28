import client from "./client";

/** How much the backend trusts that the point really is asphalt. */
export type PavedConfidence = "confirmed" | "likely" | "unknown";

/** One measured leg, including the off-path carry at the start. */
export interface AsphaltLeg {
  distanceMeters: number;
  durationMs: number;
}

export interface AsphaltAccessPoint {
  /** 1-based exit number — best first, then by time; straight-line ones last. */
  index: number;
  lat: number;
  lng: number;
  roadHint?: string;
  surfaceHint?: string;
  confidence?: PavedConfidence;
  /** Set on the single recommended point. */
  best?: boolean;
  /**
   * Incident → point leg. `foot` and `bike` are reported separately, never
   * blended — the two profiles route over different networks. `direct` = drawn
   * as a straight line because no route exists (distance is crow-flies).
   */
  incident: {
    distanceMeters: number;
    durationMs?: number;
    /** Straight-line metres from the incident to where the route begins. */
    offPathMeters?: number;
    offPathSignificant?: boolean;
    foot?: AsphaltLeg;
    bike?: AsphaltLeg;
    direct: boolean;
    noRoad?: boolean;
  };
  /** Walk path from the incident (routed points only). */
  path?: {
    geometry: Array<[number, number]>;
    elevations?: number[];
    ascentMeters?: number;
    descentMeters?: number;
    routeStartIndex?: number;
  };
  /** Caller → point by car (when a caller position was sent). */
  fromMe?: { distanceMeters: number; durationMs: number };
}

export interface ClosestAsphaltResult {
  points: AsphaltAccessPoint[];
  /** How far the expanding search reached before it had enough, metres. */
  searchRadiusMeters?: number;
}

/** Nearest paved-road access points around a location (e.g. an incident). */
export async function closestAsphalt(lat: number, lng: number): Promise<ClosestAsphaltResult> {
  const res = await client.post<ClosestAsphaltResult>("/routing/closest-asphalt", { lat, lng });
  return { points: res.data.points, searchRadiusMeters: res.data.searchRadiusMeters };
}
