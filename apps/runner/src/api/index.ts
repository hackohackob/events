import type {
  CreateIncidentRequest,
  EventTrackLike,
  GuidanceRequest,
  GuidanceResponse,
  IncidentRecordLike,
  JoinEventRequest,
  ParticipantLocationRequest,
  PublicMedicState,
  SessionPayload,
  TrackGeoJson,
} from "./contracts-shim";
import { apiGet, apiPatch, apiPost, apiPostForm } from "./client";

export async function joinEvent(payload: JoinEventRequest) {
  return apiPost<{ token: string; session: SessionPayload }>("/auth/join", payload);
}

interface EventRecordLike {
  id: string;
  title: string;
  days?: Array<{ disciplines?: Array<{ name: string; color?: string; trackId?: string }> }>;
}

/** Fetch event identity by id. Throws on 404 (used to validate a typed id). */
export async function fetchEvent(eventId: string) {
  return apiGet<EventRecordLike>(`/events/${encodeURIComponent(eventId)}`);
}

export async function fetchTracks(eventId?: string) {
  // The /events/tracks route scopes by the x-event-id header. Pass it
  // explicitly so onboarding (pre-join, no token) and event switches resolve
  // the right event's tracks.
  return apiGet<EventTrackLike[]>("/events/tracks", eventId ? { "x-event-id": eventId } : undefined);
}

export async function fetchTrackGeoJson(eventId: string, trackId: string) {
  return apiGet<TrackGeoJson>(
    `/events/${encodeURIComponent(eventId)}/tracks/${encodeURIComponent(trackId)}/geojson`,
  );
}

export async function fetchPublicMedics(eventId: string) {
  return apiGet<PublicMedicState[]>(`/events/${encodeURIComponent(eventId)}/medics/active/public`);
}

export async function fetchPois(eventId: string) {
  return apiGet<PoiLike[]>(`/events/pois`, { "x-event-id": eventId });
}

export async function createIncident(input: CreateIncidentRequest) {
  return apiPost<IncidentRecordLike>("/incidents", input);
}

export async function uploadIncidentPhoto(incidentId: string, file: File | Blob) {
  const form = new FormData();
  form.append("photo", file);
  return apiPostForm<{ url: string; photoUrls: string[] }>(
    `/incidents/${encodeURIComponent(incidentId)}/photo`,
    form,
  );
}

export async function fetchMyIncidents() {
  return apiGet<IncidentRecordLike[]>("/incidents/mine");
}

export async function updateIncidentDetails(incidentId: string, patch: { description?: string }) {
  return apiPatch<IncidentRecordLike>(`/incidents/${encodeURIComponent(incidentId)}`, patch);
}

export async function uploadIncidentVoice(incidentId: string, audio: Blob, durationMs?: number) {
  const form = new FormData();
  form.append("audio", audio, "voice.webm");
  if (durationMs) form.append("durationMs", String(durationMs));
  return apiPostForm<unknown>(`/incidents/${encodeURIComponent(incidentId)}/voice`, form);
}

export async function postParticipantLocation(eventId: string, body: ParticipantLocationRequest) {
  return apiPost<{ ok: boolean }>(`/events/${encodeURIComponent(eventId)}/location`, body);
}

export async function fetchGuidance(req: GuidanceRequest) {
  return apiPost<GuidanceResponse>("/guidance", req);
}

export interface PoiLike {
  id: string;
  type: string;
  lat: number;
  lng: number;
  name?: string;
  icon?: string;
}
