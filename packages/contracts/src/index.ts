export type UserRole = "runner" | "paramedic" | "coordinator" | "spectator" | "medic";

export type VehicleType =
  | "foot"
  | "bicycle"
  | "e-bike"
  | "electric-motorcycle"
  | "atv"
  | "suv"
  | "ambulance";

export type MedicStatus = "available" | "stationary" | "rest" | "going_to";

/** Roster-level classification of a medic. */
export type MedicType = "coordinator" | "paramedic" | "medic";

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface JoinEventRequest {
  joinCode: string;
  /** Runner name (required when role = runner) */
  name?: string;
  bibNumber?: string;
  phone?: string;
  role?: "runner" | "medic";
  /** Medic roster ID (required when role = medic) */
  medicId?: string;
}

export interface SessionPayload {
  eventId: string;
  userId: string;
  role: UserRole;
  /** Display name, present for medics and optionally for runners */
  name?: string;
}

// ─── Medic roster ────────────────────────────────────────────────────────────

export interface EventMedic {
  id: string;
  eventId: string;
  name: string;
  unit?: string;
  vehicle?: string;
  type?: MedicType;
  /** Medical skills, e.g. "ALS", "Paediatrics" */
  skills?: string[];
  /** Equipment / capabilities the medic can deploy, e.g. "AED", "O2" */
  capabilities?: string[];
}

export interface AddMedicRequest {
  name: string;
  unit?: string;
  vehicle?: string;
  type?: MedicType;
  skills?: string[];
  capabilities?: string[];
}

export interface UpdateMedicStatusRequest {
  status: Extract<MedicStatus, "available" | "stationary" | "rest">;
}

/** Dashboard → all medics broadcast alert */
export interface BroadcastRequest {
  title: string;
  body: string;
}

// ─── Medic live state ────────────────────────────────────────────────────────

export interface MedicDestination {
  lat: number;
  lng: number;
  label: string;
}

/** Surface class for a stretch of a navigation route. */
export type RouteSurface = "road" | "offroad" | "path";

/** One colour-classified run of a navigation route, `[lng, lat]` coordinates. */
export interface MedicRouteSegment {
  surface: RouteSurface;
  coordinates: [number, number][];
}

/**
 * The active navigation path a medic is following, broadcast to every device +
 * the dashboard so the route is visible to the whole team (with surface colours
 * and an ETA), exactly as the navigating medic sees it.
 */
export interface MedicRoute {
  /** Full geometry, `[lng, lat]`. */
  geometry: [number, number][];
  /** Colour-classified runs covering the geometry. */
  segments: MedicRouteSegment[];
  distanceMeters: number;
  durationMs: number;
  /** ISO ETA computed when the route was set. */
  etaIso?: string;
  /** Whether this route leads to an incident (vs a plain point). */
  incidentId?: string | null;
}

/** Persisted + broadcast state for a single medic */
export interface MedicState {
  medicId: string;
  eventId: string;
  name: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  /** Device battery level 0–1 at the time of the last update */
  battery?: number;
  status: MedicStatus;
  destination?: MedicDestination | null;
  /** Active navigation path (set while navigating), or null. */
  route?: MedicRoute | null;
  recordedAt: string;
  lastSeenAt: string;
}

/** WS message sent by a medic's device → server */
export interface WsMedicLocation {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  /** Device battery level 0–1 */
  battery?: number;
}

export interface AssignMedicDestinationRequest {
  destination: MedicDestination | null;
}

// ─── Participant location ─────────────────────────────────────────────────────

export interface ParticipantLocationRequest {
  lat: number;
  lng: number;
  accuracy?: number;
  /** Device battery level 0–1 */
  battery?: number;
  timestamp: string;
}

export interface ParticipantLastLocation {
  userId: string;
  eventId: string;
  name: string;
  bibNumber?: string;
  phone?: string;
  lat: number;
  lng: number;
  accuracy?: number;
  battery?: number;
  recordedAt: string;
  lastSeenAt: string;
}

// ─── Legacy location (kept for backwards compat) ─────────────────────────────

export interface LocationUpdate {
  eventId: string;
  userId: string;
  lat: number;
  lng: number;
  accuracy?: number;
  /** Device battery level 0–1 */
  battery?: number;
  timestamp: string;
}

// ─── Incidents ───────────────────────────────────────────────────────────────

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "assigned" | "in_progress" | "resolved" | "closed";

/**
 * Standardised incident categories reported by the Runner Companion PWA. The
 * first four match the hi-fi design's 2×2 grid; the rest cover the wider range
 * of things that can happen to a runner on course. Each maps to a default
 * severity (see INCIDENT_CATEGORY_SEVERITY).
 */
export type IncidentCategory =
  | "severe_injury"
  | "chest_pain"
  | "collapse"
  | "minor_injury"
  | "heat_illness"
  | "dehydration"
  | "hypothermia"
  | "allergic_reaction"
  | "seizure"
  | "fall_trauma"
  | "lost_disoriented"
  | "other";

/** Default severity per category — drives triage colour + ordering. */
export const INCIDENT_CATEGORY_SEVERITY: Record<IncidentCategory, IncidentSeverity> = {
  severe_injury: "critical",
  chest_pain: "critical",
  collapse: "critical",
  seizure: "critical",
  allergic_reaction: "high",
  fall_trauma: "high",
  hypothermia: "high",
  heat_illness: "high",
  dehydration: "medium",
  minor_injury: "medium",
  lost_disoriented: "medium",
  other: "low",
};

export interface CreateIncidentRequest {
  eventId: string;
  lat: number;
  lng: number;
  /** Free-form label; optional when `category` is supplied (it derives one). */
  type?: string;
  description?: string;
  severity?: IncidentSeverity;
  photoUrl?: string;
  /** Standardised category from the runner PWA. */
  category?: IncidentCategory;
  /** GPS accuracy radius in metres at capture time. */
  accuracy?: number;
  /** Reporter bib number (runner PWA). */
  bibNumber?: string;
  /** Reporter display name (runner PWA). */
  runnerName?: string;
  /** Client capture time (ISO8601). */
  timestamp?: string;
}

/** Runner-facing response after creating an incident (medic dispatch summary). */
export interface CreatedIncidentResponse {
  incidentId: string;
  assignedMedicId: string | null;
  etaMinutes: number | null;
}

/**
 * Trimmed medic position safe to expose to runners — no battery, route, or
 * destination internals. Powers the runner map markers + nearest-medic pill.
 */
export interface PublicMedicState {
  medicId: string;
  name: string;
  lat: number;
  lng: number;
  status: MedicStatus;
  recordedAt: string;
}

/** Track route as GeoJSON, cacheable offline by the runner PWA. */
export interface TrackGeoJson {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    /** Coordinates are `[lng, lat]` or `[lng, lat, ele]` when elevation is known. */
    geometry: { type: "LineString"; coordinates: number[][] };
    properties: {
      trackId: string;
      label: string;
      color?: string;
      totalAscentMeters: number;
      totalDescentMeters: number;
      maxElevationMeters: number | null;
      minElevationMeters: number | null;
    };
  }>;
}

/** Guided ABC care step. */
export type AbcStep = "A" | "B" | "C";

export interface GuidanceRequest {
  transcript: string;
  category?: IncidentCategory;
}

export interface GuidanceResponse {
  currentStep: AbcStep;
  instruction: string;
  note: string;
}

/** Casualty-care summary captured when an incident is closed. */
export interface CloseIncidentRequest {
  vitals?: string;
  treatment?: string;
  transport?: string;
}

export interface IncidentMessage {
  id: string;
  incidentId: string;
  eventId: string;
  authorId: string;
  authorName: string;
  text: string;
  photoUrl?: string;
  /** Voice note attachment (server-relative URL) and its length. */
  audioUrl?: string;
  audioDurationMs?: number;
  createdAt: string;
}

export interface SendIncidentMessageRequest {
  text: string;
  photoUrl?: string;
}

export type IncidentActionType = "going" | "arrived" | "need_backup" | "resolved" | "stand_down";

export interface IncidentActionRequest {
  incidentId: string;
  action: IncidentActionType;
}

export interface RunnerSearchQuery {
  eventId: string;
  name?: string;
  bibNumber?: string;
}

export interface RealtimeEnvelope<TPayload> {
  eventId: string;
  type: string;
  payload: TPayload;
}
