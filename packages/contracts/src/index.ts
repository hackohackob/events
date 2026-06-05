export type UserRole = "runner" | "paramedic" | "coordinator" | "spectator" | "medic";

export type VehicleType =
  | "foot"
  | "bicycle"
  | "e-bike"
  | "electric-motorcycle"
  | "atv"
  | "suv"
  | "ambulance";

export type MedicStatus = "available" | "rest" | "going_to";

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
  status: Extract<MedicStatus, "available" | "rest">;
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

export interface CreateIncidentRequest {
  eventId: string;
  lat: number;
  lng: number;
  type: string;
  description: string;
  severity?: IncidentSeverity;
  photoUrl?: string;
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
