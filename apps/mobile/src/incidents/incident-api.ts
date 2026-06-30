import { apiFetch } from "../ui/api-client";
import { useSessionStore } from "../security/session-store";
import { resolveLocalhostUrl } from "../ui/runtime-host";
import type { IncidentSeverity, IncidentType, NearbyParamedic } from "./incident-store";
import type { PendingIncidentPayload } from "./persistent-incident-queue";

const API_BASE_URL = resolveLocalhostUrl(
  process.env.EXPO_PUBLIC_API_URL ?? "https://events-api.hackohackob.com/api",
);

export interface CreateIncidentResponse {
  id: string;
  name?: string;
  nearbyParamedics: NearbyParamedic[];
}

export interface UpdateIncidentPayload {
  type: IncidentType;
  peopleAffected: number;
  description: string;
  photoUrl?: string;
  severity?: IncidentSeverity;
  /** Participant BIB — server resolves the patient's identity + medical from it. */
  patientBib?: string;
}

export async function createIncident(payload: PendingIncidentPayload): Promise<CreateIncidentResponse> {
  return apiFetch<CreateIncidentResponse>("/incidents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateIncident(id: string, payload: UpdateIncidentPayload): Promise<void> {
  await apiFetch<void>(`/incidents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/**
 * Upload a recorded voice note. The server stores it and immediately posts it
 * to the incident chat as a message with an audio attachment.
 */
export async function uploadIncidentVoice(
  id: string,
  uri: string,
  durationMs: number,
): Promise<{ id: string; incidentId: string; authorId: string; authorName: string; text: string; audioUrl?: string; audioDurationMs?: number; createdAt: string }> {
  const state = useSessionStore.getState();
  const formData = new FormData();
  const filename = uri.split("/").pop() ?? "voice.m4a";
  const match = /\.(\w+)$/.exec(filename);
  const type = match ? `audio/${match[1]}` : "audio/m4a";
  formData.append("audio", { uri, name: filename, type } as unknown as Blob);
  formData.append("durationMs", String(Math.round(durationMs)));

  const headers = new Headers();
  if (state.token) headers.set("authorization", `Bearer ${state.token}`);
  headers.set("x-user-id", state.userId ?? "mobile-user");
  headers.set("x-event-id", state.eventId ?? "event-demo");
  headers.set("x-role", state.role);

  const response = await fetch(`${API_BASE_URL}/incidents/${id}/voice`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!response.ok) throw new Error(`Voice upload failed: ${response.status}`);
  return response.json();
}

export async function uploadIncidentPhoto(id: string, uri: string): Promise<string> {
  const state = useSessionStore.getState();
  const formData = new FormData();
  const filename = uri.split("/").pop() ?? "photo.jpg";
  const match = /\.(\w+)$/.exec(filename);
  const type = match ? `image/${match[1]}` : "image/jpeg";
  formData.append("photo", { uri, name: filename, type } as unknown as Blob);

  const headers = new Headers();
  if (state.token) headers.set("authorization", `Bearer ${state.token}`);
  headers.set("x-user-id", "mobile-user");
  headers.set("x-event-id", state.eventId ?? "event-demo");
  headers.set("x-role", state.role);

  const response = await fetch(`${API_BASE_URL}/incidents/${id}/photo`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!response.ok) throw new Error(`Photo upload failed: ${response.status}`);
  const json = (await response.json()) as { url: string };
  return json.url;
}
