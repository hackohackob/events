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
import { apiGet, apiPost, apiPostForm } from "./client";

export async function joinEvent(payload: JoinEventRequest) {
  return apiPost<{ token: string; session: SessionPayload }>("/auth/join", payload);
}

export async function fetchTracks() {
  return apiGet<EventTrackLike[]>("/events/tracks");
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
  // eventId scope comes from the auth headers; the route ignores the param.
  void eventId;
  return apiGet<PoiLike[]>(`/events/pois`);
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
