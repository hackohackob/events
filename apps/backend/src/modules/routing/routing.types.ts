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
  /**
   * Roundabouts only (sign 6): which exit to take, 1-based. Without it the
   * client can only say "enter the roundabout", which is useless on the ground.
   */
  exitNumber?: number;
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

/** Incident → exit-point walk/carry path, with an elevation series for the
 *  client's profile preview. */
export interface AsphaltAccessPath {
  /** `[lng, lat]` polyline from the incident to the point. */
  geometry: LngLat[];
  /** Elevation (m) per geometry vertex, when GraphHopper returned it. */
  elevations?: number[];
  ascentMeters?: number;
  descentMeters?: number;
  /**
   * Index into `geometry` where the routed network begins. Vertex 0 is always
   * the incident itself; everything before this index is the off-path carry, so
   * the client can draw that stretch differently (dashed).
   */
  routeStartIndex?: number;
}

/** How much we trust that the point really is asphalt. See surface-classification. */
export type PavedConfidence = "confirmed" | "likely" | "unknown";

/** One measured leg on a given profile. */
export interface AsphaltAccessLeg {
  /** Metres, including the off-path carry at the start. */
  distanceMeters: number;
  /** Milliseconds, including the off-path carry at the start. */
  durationMs: number;
}

/** One paved-road access ("exit") point near an incident. */
export interface AsphaltAccessPoint {
  /** 1-based exit number — best first, then by time; straight-line ones last. */
  index: number;
  lat: number;
  lng: number;
  /** Road class when GraphHopper knows it (e.g. "residential"). */
  roadHint?: string;
  /** OSM `surface` tag at the point, when tagged. */
  surfaceHint?: string;
  /** Tag-confidence tier — the client shows unverified surfaces differently. */
  confidence: PavedConfidence;
  /** Set on the single recommended point. */
  best?: boolean;
  /**
   * Incident → point leg.
   *
   * `foot` and `bike` are reported separately and deliberately NOT blended: the
   * two profiles route over different networks, so an average matched neither
   * and hid which one the number came from. A stretcher party reads `foot`; a
   * medic on a bike reads `bike`.
   *
   * `direct: true` means no route exists and the client draws a straight line;
   * `distanceMeters` is then the crow-flies distance.
   */
  incident: {
    /** Best available distance — the foot leg when routed, else crow-flies. */
    distanceMeters: number;
    /** Fastest of the routed profiles, ms. Absent when nothing routed. */
    durationMs?: number;
    /** Straight-line metres from the incident to where the route begins. */
    offPathMeters: number;
    /** True when the carry is long enough to be worth calling out. */
    offPathSignificant?: boolean;
    foot?: AsphaltAccessLeg;
    bike?: AsphaltAccessLeg;
    direct: boolean;
    noRoad?: boolean;
  };
  /** Caller → point by car, when the caller's position was provided and routable. */
  fromMe?: { distanceMeters: number; durationMs: number };
  /** Drawable walk path — present for routed points only. */
  path?: AsphaltAccessPath;
}

export interface ClosestAsphaltResponse {
  origin: { lat: number; lng: number };
  points: AsphaltAccessPoint[];
  /** How far out the expanding search had to reach before it had enough, metres. */
  searchRadiusMeters?: number;
}
