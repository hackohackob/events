/**
 * Wire format between the JS app and the native Android Auto car app.
 *
 * The car app is 100% native (androidx.car.app templates + a Canvas map
 * renderer) — React Native cannot render onto a car screen. So the phone side's
 * only job is to mirror the stores the car needs, and to run the actions the
 * car asks for through the SAME store functions the phone UI calls. No forked
 * behaviour: `CarAction` handlers are thin adapters, never re-implementations.
 *
 * Two channels, split by how often the data changes:
 *
 *  - {@link CarStatic}  — tracks, zones, tile URL, build info. Kilobytes, but
 *    changes maybe once an event. Pushed only on change.
 *  - {@link CarDynamic} — position, markers, nav progress, diagnostics. Small,
 *    but changes constantly. Pushed at most {@link DYNAMIC_PUSH_INTERVAL_MS}.
 *
 * Nothing is pushed at all while Android Auto is disconnected — see
 * `car-bridge.ts`. A parked phone must not pay for a feature nobody is looking
 * at (the battery guardrails apply here as much as to the map screen).
 */

/** Bumped when a field's meaning changes; native refuses mismatched payloads. */
export const CAR_PROTOCOL_VERSION = 1;

/** Ceiling on dynamic pushes. GPS lands at ~1 Hz, so 2 Hz is already generous. */
export const DYNAMIC_PUSH_INTERVAL_MS = 500;

/** Flat `[lng, lat, lng, lat, …]`. Half the JSON of an array of pairs. */
export type FlatCoords = number[];

export interface CarPolyline {
  id: string;
  label: string;
  /** `#rrggbb`. Native falls back to a default when absent or unparseable. */
  color?: string;
  points: FlatCoords;
}

export interface CarPolygon {
  id: string;
  label: string;
  color?: string;
  points: FlatCoords;
}

export interface CarStatic {
  v: number;
  /** `{z}/{x}/{y}` raster template, or null when no Mapy key is configured. */
  tileUrlTemplate: string | null;
  /** Race tracks, simplified for a car screen. */
  tracks: CarPolyline[];
  /** Team zones this device has chosen to show. */
  zones: CarPolygon[];
  build: {
    appVersion: string;
    nativeBuild: string;
    runtimeVersion: string;
    updateId: string | null;
    channel: string | null;
    updateAppliedAt: number | null;
    firstLaunchAt: number | null;
  };
}

export type CarMarkerType = "paramedic" | "incident" | "infrastructure" | "runner";

export interface CarMarker {
  id: string;
  type: CarMarkerType;
  label: string;
  lat: number;
  lng: number;
  /** Medics only: available | stationary | rest | going_to | sweeper. */
  status?: string;
  /** Medics only — drives the glyph. */
  vehicleType?: string;
  /** POIs only — drives the glyph. */
  poiType?: string;
  /** Incidents only. */
  incidentType?: string;
  /** Incidents only: open | resolved | closed | archived. */
  incidentStatus?: string;
  /** Medic freshness ring: fresh | warning | stale | offline. */
  staleState?: string;
  /** True for the incident this device is assigned to. */
  assignedToMe?: boolean;
  /** True for this device's own medic marker. */
  isMe?: boolean;
  /** Metres from this device, precomputed so native never re-sorts on geo. */
  distanceMeters?: number;
}

export type CarNavMode = "none" | "point" | "track";

export interface CarNav {
  mode: CarNavMode;
  /** True only in the fully-committed active phase; the car never shows setup. */
  active: boolean;
  destinationLabel: string | null;
  /** The route/track line being followed. */
  routePoints: FlatCoords;
  /** Portion already covered — drawn dimmed so progress reads at a glance. */
  travelledPoints: FlatCoords;
  remainingMeters: number | null;
  remainingMs: number | null;
  toManeuverMeters: number | null;
  /** A {@link import("../navigation/types").ManeuverKind}. */
  maneuver: string | null;
  /** Spoken/banner text for the upcoming maneuver. */
  cue: string | null;
  /** Street name for the upcoming maneuver, when the engine gave one. */
  road: string | null;
  offRoute: boolean;
  /** Course over ground for the heading-up camera, degrees. */
  bearing: number | null;
  speedMps: number | null;
  voiceMuted: boolean;
}

export interface CarDiagnostics {
  /** Age of the newest GPS fix, ms. Null when there has never been one. */
  fixAgeMs: number | null;
  accuracyMeters: number | null;
  batteryPercent: number | null;
  /** Last server report: ok/failed and how it went out. */
  lastReportOk: boolean | null;
  lastReportVia: string | null;
  lastReportAgeMs: number | null;
  socketConnected: boolean;
  online: boolean;
  queuedLocations: number;
  queuedIncidents: number;
  /** Reporting cadence actually in force (includes the stationary floor). */
  effectiveIntervalMs: number;
  trackingIssues: string[];
  batteryOptimizationIgnored: boolean | null;
  drainPercentPerHour: number | null;
}

/** Car-adjustable settings. Only switches and short preset lists — Android Auto
 *  has no slider and no text field, and long lists are refused while driving. */
export interface CarSettings {
  locationIntervalMs: number;
  trackOffsetEnabled: boolean;
  trackGradientEnabled: boolean;
  kmMarkersEnabled: boolean;
  kmMarkerIntervalKm: number;
  showArchived: boolean;
  androidAutoEnabled: boolean;
  /** Mirrors nav voice mute so the car can toggle it without a nav session. */
  voiceMuted: boolean;
}

export interface CarDynamic {
  v: number;
  signedIn: boolean;
  /** False until the session store has read AsyncStorage — avoids a false
   *  "sign in on your phone" flash on a cold headless start. */
  hydrated: boolean;
  eventTitle: string | null;
  userId: string | null;
  role: string;
  /** Medic-only features (status, incident response) are hidden for runners. */
  isMedic: boolean;
  me: { lat: number; lng: number; accuracyMeters: number | null; at: number } | null;
  myStatus: string;
  markers: CarMarker[];
  /** Other medics' shared route lines. */
  medicRoutes: CarPolyline[];
  assignedIncidentId: string | null;
  nav: CarNav;
  settings: CarSettings;
  diagnostics: CarDiagnostics;
  /** Set while a voice message is recording, so the car can show/stop it. */
  recording: boolean;
  /** Transient banner text for the car (queued sends, errors). */
  toast: string | null;
}

/** Everything the car screens can ask the phone to do. */
export type CarAction =
  | { type: "navigate"; lat: number; lng: number; label: string; incidentId?: string | null; profile?: string }
  | { type: "stopNav" }
  | { type: "recenter" }
  | { type: "toggleVoiceMute" }
  | { type: "setStatus"; status: string }
  | { type: "respond"; incidentId: string }
  | { type: "standDown"; incidentId: string }
  | { type: "setSetting"; key: keyof CarSettings; value: boolean | number }
  | { type: "recordStart" }
  | { type: "recordStop"; send: boolean }
  | { type: "requestRefresh" };
