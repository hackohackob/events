/**
 * Mobile-side mirror of the backend routing contract
 * (`apps/backend/src/modules/routing/routing.types.ts`). Kept as a local copy
 * so the navigation module has no backend import coupling, matching how the rest
 * of the app declares its own response interfaces.
 */

export type RouteProfile = "foot" | "mtb" | "car" | "rescue_4x4";

export type SurfaceClass = "road" | "offroad" | "path";

/** `[lng, lat]` (GeoJSON order). */
export type LngLat = [number, number];

export type ManeuverKind =
  | "depart"
  | "arrive"
  | "continue"
  | "turn-slight-left"
  | "turn-left"
  | "turn-sharp-left"
  | "turn-slight-right"
  | "turn-right"
  | "turn-sharp-right"
  | "uturn"
  | "roundabout"
  | "keep-left"
  | "keep-right"
  | "via";

export interface RouteSegment {
  surface: SurfaceClass;
  coordinates: LngLat[];
  roadClass?: string;
  surfaceTag?: string;
}

export interface RouteInstruction {
  text: string;
  maneuver: ManeuverKind;
  sign: number;
  distanceMeters: number;
  timeMs: number;
  streetName?: string;
  interval: [number, number];
  location?: LngLat;
}

export interface RouteVariant {
  id: string;
  distanceMeters: number;
  durationMs: number;
  ascentMeters?: number;
  descentMeters?: number;
  geometry: LngLat[];
  segments: RouteSegment[];
  instructions: RouteInstruction[];
}

export interface RouteResponse {
  profile: RouteProfile;
  routes: RouteVariant[];
  waypoints: LngLat[];
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** A waypoint in the editable route (start, a via stop, or the destination). */
export interface Waypoint extends LatLng {
  kind: "start" | "via" | "dest";
  label: string;
}
