import client from "./client";
import type { CreateIncidentRequest, IncidentActionRequest } from "@events/contracts";

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

export async function actionIncident(incidentId: string, payload: IncidentActionRequest) {
  const res = await client.patch(`/incidents/${incidentId}/action`, payload);
  return res.data;
}

export async function assignIncident(incidentId: string, paramedicId: string) {
  const res = await client.patch(`/incidents/${incidentId}/assign/${paramedicId}`);
  return res.data;
}

export async function assignMedicToIncident(
  _eventId: string,
  incidentId: string,
  paramedicId: string,
): Promise<void> {
  // eventId is carried by the auth interceptor via x-event-id header
  await client.patch(`/incidents/${incidentId}/assign/${paramedicId}`);
}
