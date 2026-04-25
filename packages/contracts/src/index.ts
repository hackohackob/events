export type UserRole = "runner" | "paramedic" | "coordinator" | "spectator";

export type VehicleType =
  | "foot"
  | "bicycle"
  | "e-bike"
  | "electric-motorcycle"
  | "atv"
  | "suv"
  | "ambulance";

export interface JoinEventRequest {
  joinCode: string;
  name: string;
  bibNumber?: string;
}

export interface SessionPayload {
  eventId: string;
  userId: string;
  role: UserRole;
}

export interface LocationUpdate {
  eventId: string;
  userId: string;
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: string;
}

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
