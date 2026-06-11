/**
 * Routing contract shared between the GraphHopper proxy and the mobile client.
 *
 * The backend owns the GraphHopper call, the rescue custom models and the
 * surface classification, so the mobile app only ever consumes already-coloured
 * segments + maneuver instructions and never needs to know GraphHopper details.
 */

/** Routing profiles exposed to the app. `rescue_4x4` is our custom model. */
export type RouteProfile = "foot" | "mtb" | "car" | "rescue_4x4";

/** Visualization class for a stretch of route. */
export type SurfaceClass = "road" | "offroad" | "path";

/** `[lng, lat]` pair (GeoJSON order). */
export type LngLat = [number, number];

/** A run of consecutive geometry sharing one surface class — drawn as one colour. */
export interface RouteSegment {
  surface: SurfaceClass;
  /** GeoJSON LineString coordinates, `[lng, lat]`. */
  coordinates: LngLat[];
  /** Dominant OSM road_class for the run (debug / tooltip). */
  roadClass?: string;
  /** Dominant OSM surface tag for the run, when known. */
  surfaceTag?: string;
}

/** One turn-by-turn maneuver, mapped from a GraphHopper instruction. */
export interface RouteInstruction {
  /** Human readable text, e.g. "Turn left onto Forest Road". */
  text: string;
  /** Maneuver bucket the client renders an arrow for. */
  maneuver: ManeuverKind;
  /** Raw GraphHopper sign (-3..6) for clients that want finer control. */
  sign: number;
  /** Distance of this leg in metres. */
  distanceMeters: number;
  /** Estimated time of this leg in ms. */
  timeMs: number;
  /** Street / way name, when GraphHopper provides one. */
  streetName?: string;
  /** `[fromIndex, toIndex]` into the route's point array. */
  interval: [number, number];
  /** Location of the maneuver, `[lng, lat]`. */
  location?: LngLat;
}

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

/** A single computed route (primary or alternative). */
export interface RouteVariant {
  /** Stable id within the response — "A", "B", "C"… */
  id: string;
  distanceMeters: number;
  durationMs: number;
  ascentMeters?: number;
  descentMeters?: number;
  /** Full geometry, `[lng, lat]`. */
  geometry: LngLat[];
  /** Colour-classified runs covering the whole geometry. */
  segments: RouteSegment[];
  instructions: RouteInstruction[];
}

export interface RouteResponse {
  profile: RouteProfile;
  routes: RouteVariant[];
  /** Echo of the waypoints the route was built through, `[lng, lat]`. */
  waypoints: LngLat[];
}
