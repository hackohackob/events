import client from "./client";
import type { CreateIncidentRequest, IncidentActionRequest } from "@events/contracts";

export async function listIncidents() {
  const res = await client.get("/incidents");
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
