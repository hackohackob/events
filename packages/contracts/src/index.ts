export type UserRole = "runner" | "paramedic" | "coordinator" | "spectator" | "medic";

export type VehicleType =
  | "foot"
  | "bicycle"
  | "e-bike"
  | "electric-motorcycle"
  | "atv"
  | "suv"
  | "ambulance";

export type MedicStatus = "available" | "going_to";

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
}

export interface AddMedicRequest {
  name: string;
  unit?: string;
  vehicle?: string;
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
}

export interface AssignMedicDestinationRequest {
  destination: MedicDestination | null;
}

// ─── Participant location ─────────────────────────────────────────────────────

export interface ParticipantLocationRequest {
  lat: number;
  lng: number;
  accuracy?: number;
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
  timestamp: string;
}

// ─── Incidents ───────────────────────────────────────────────────────────────

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "assigned" | "in_progress" | "resolved";

export interface CreateIncidentRequest {
  eventId: string;
  lat: number;
  lng: number;
  type: string;
  description: string;
  severity?: IncidentSeverity;
  photoUrl?: string;
}

export type IncidentActionType = "going" | "arrived" | "need_backup" | "resolved";

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
