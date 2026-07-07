import { apiFetch } from "./api-client";
import { useSessionStore } from "../security/session-store";

function eventId(): string {
  return useSessionStore.getState().eventId ?? "";
}
function myId(): string {
  return useSessionStore.getState().userId ?? "";
}

export interface Destination {
  lat: number;
  lng: number;
  label: string;
}

/** Set my own status (Available / Rest). "Going to X" is set via assignDestination. */
export async function setMyStatus(status: "available" | "stationary" | "rest") {
  return apiFetch(`/events/${eventId()}/medics/${myId()}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export interface SharedRoute {
  geometry: Array<[number, number]>;
  segments: Array<{ surface: "road" | "offroad" | "path"; coordinates: Array<[number, number]> }>;
  distanceMeters: number;
  durationMs: number;
  etaIso?: string;
  incidentId?: string | null;
}

/**
 * Publish (or clear) my active navigation path so the whole team + dashboard can
 * see the coloured route + ETA I'm following. Pass null to clear.
 */
export async function setMyRoute(route: SharedRoute | null, destination: Destination | null = null) {
  return apiFetch(`/events/${eventId()}/medics/${myId()}/route`, {
    method: "PATCH",
    body: JSON.stringify({ route, destination }),
  });
}

/** Assign a medic (default: me) to a destination, or pass null to clear. */
export async function assignDestination(destination: Destination | null, medicId: string = myId()) {
  return apiFetch(`/events/${eventId()}/medics/${medicId}/assign`, {
    method: "PATCH",
    body: JSON.stringify({ destination }),
  });
}

export interface IncidentMessageDto {
  id: string;
  incidentId: string;
  authorId: string;
  authorName: string;
  text: string;
  /** "text" | "voice" | "first_aid" | "cpr" | "system" — structured kinds carry `meta`. */
  kind?: string;
  /** Structured context for first_aid/cpr entries (question, answer, action, durationMs …). */
  meta?: Record<string, unknown>;
  /** Photo attachment (server-relative URL) — e.g. a photo added from the PWA. */
  photoUrl?: string;
  /** Voice note attachment (server-relative URL) and its length. */
  audioUrl?: string;
  audioDurationMs?: number;
  /** Speech-to-text transcript of a voice note, when available. */
  transcript?: string;
  createdAt: string;
}

export async function listIncidentMessages(incidentId: string): Promise<IncidentMessageDto[]> {
  return apiFetch<IncidentMessageDto[]>(`/incidents/${incidentId}/messages`);
}

export async function sendIncidentMessage(incidentId: string, text: string): Promise<IncidentMessageDto> {
  return apiFetch<IncidentMessageDto>(`/incidents/${incidentId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function closeIncident(
  incidentId: string,
  payload: { vitals?: string; treatment?: string; transport?: string },
) {
  return apiFetch(`/incidents/${incidentId}/close`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/** Partial update of an incident (category, severity, status, …). */
export async function patchIncident(
  incidentId: string,
  patch: { type?: string; severity?: string; status?: string; description?: string },
) {
  return apiFetch(`/incidents/${incidentId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Archive an incident — removes it from the active board. */
export async function archiveIncident(incidentId: string) {
  return patchIncident(incidentId, { status: "archived" });
}

/** Register myself as a responder heading to an incident. */
export async function respondToIncident(incidentId: string) {
  return apiFetch(`/incidents/${incidentId}/action`, {
    method: "PATCH",
    body: JSON.stringify({ action: "going" }),
  });
}

/** Step myself back from an incident (removes me from its responders). */
export async function standDownIncident(incidentId: string) {
  return apiFetch(`/incidents/${incidentId}/action`, {
    method: "PATCH",
    body: JSON.stringify({ action: "stand_down" }),
  });
}

/** Coordinator: assign another medic as a responder to an incident. */
export async function assignIncidentResponder(incidentId: string, paramedicId: string) {
  return apiFetch(`/incidents/${incidentId}/assign/${paramedicId}`, { method: "PATCH" });
}

/** Coordinator: remove a specific medic from an incident's responders. */
export async function unassignIncidentResponder(incidentId: string, paramedicId: string) {
  return apiFetch(`/incidents/${incidentId}/assign/${paramedicId}`, { method: "DELETE" });
}

export interface PoiDto {
  id: string;
  type: string;
  lat: number;
  lng: number;
  name?: string;
  description?: string;
  /** Custom glyph key for "custom" points; overrides the default type icon. */
  icon?: string;
}

/** Drop a new point of interest at the given coordinates. */
export async function createPoi(input: {
  lat: number;
  lng: number;
  type?: string;
  name?: string;
  description?: string;
  /** Custom glyph key for "custom" points; overrides the default type icon. */
  icon?: string;
}): Promise<PoiDto> {
  return apiFetch<PoiDto>(`/events/pois`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Archive a POI — hides it from the map for everyone. */
export async function archivePoi(poiId: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/events/pois/${poiId}`, { method: "DELETE" });
}

/** Update a POI — e.g. move it to a new position. Broadcast to everyone live. */
export async function updatePoi(
  poiId: string,
  patch: { name?: string; description?: string; lat?: number; lng?: number },
): Promise<PoiDto> {
  return apiFetch<PoiDto>(`/events/${eventId()}/pois/${poiId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
