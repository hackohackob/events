import client from "./client";
import type {
  CloseIncidentRequest,
  CreateIncidentRequest,
  IncidentActionRequest,
  IncidentMessage,
  SendIncidentMessageRequest,
} from "@events/contracts";

export async function listIncidents(eventId?: string) {
  const headers: Record<string, string> = {};
  if (eventId) headers["x-event-id"] = eventId;
  const res = await client.get("/incidents", { headers });
  return res.data as any[];
}

export async function createIncident(payload: CreateIncidentRequest) {
  const res = await client.post("/incidents", payload);
  return res.data;
}

/** Scope a request to a specific event (the dashboard has no per-event session token). */
function eventHeaders(eventId?: string): Record<string, string> {
  return eventId ? { "x-event-id": eventId } : {};
}

export async function actionIncident(incidentId: string, payload: IncidentActionRequest, eventId?: string) {
  const res = await client.patch(`/incidents/${incidentId}/action`, payload, { headers: eventHeaders(eventId) });
  return res.data;
}

export async function assignIncident(incidentId: string, paramedicId: string) {
  const res = await client.patch(`/incidents/${incidentId}/assign/${paramedicId}`);
  return res.data;
}

export async function assignMedicToIncident(
  eventId: string,
  incidentId: string,
  paramedicId: string,
): Promise<void> {
  // The dashboard has no per-event session token, so the event scope must be
  // sent explicitly — without it the backend resolves the wrong event and the
  // incident lookup 404s.
  await client.patch(`/incidents/${incidentId}/assign/${paramedicId}`, undefined, {
    headers: eventHeaders(eventId),
  });
}

/** Partial details update (notes/category/severity) scoped to an event. */
export async function updateIncidentDetails(
  incidentId: string,
  payload: { description?: string; type?: string; severity?: string },
  eventId?: string,
) {
  const res = await client.patch(`/incidents/${incidentId}`, payload, { headers: eventHeaders(eventId) });
  return res.data;
}

export async function closeIncident(incidentId: string, payload: CloseIncidentRequest, eventId?: string) {
  const res = await client.patch(`/incidents/${incidentId}/close`, payload, { headers: eventHeaders(eventId) });
  return res.data;
}

export async function listIncidentMessages(incidentId: string, eventId?: string): Promise<IncidentMessage[]> {
  const res = await client.get<IncidentMessage[]>(`/incidents/${incidentId}/messages`, { headers: eventHeaders(eventId) });
  return res.data;
}

export async function sendIncidentMessage(
  incidentId: string,
  payload: SendIncidentMessageRequest,
  eventId?: string,
): Promise<IncidentMessage> {
  const res = await client.post<IncidentMessage>(`/incidents/${incidentId}/messages`, payload, { headers: eventHeaders(eventId) });
  return res.data;
}
