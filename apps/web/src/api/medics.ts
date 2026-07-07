import type { EventMedic, MedicState, ParticipantLastLocation } from "@events/contracts";
import client from "./client";

export async function getMedicRoster(eventId: string): Promise<EventMedic[]> {
  const { data } = await client.get<EventMedic[]>(`/events/${eventId}/medics`);
  return data;
}

export async function getActiveMedics(eventId: string): Promise<MedicState[]> {
  const { data } = await client.get<MedicState[]>(`/events/${eventId}/medics/active`);
  return data;
}

export async function addMedic(eventId: string, payload: { name: string; unit?: string; vehicle?: string }): Promise<EventMedic> {
  const { data } = await client.post<EventMedic>(`/events/${eventId}/medics`, payload);
  return data;
}

export async function assignMedicDestination(
  eventId: string,
  medicId: string,
  destination: { lat: number; lng: number; label: string } | null,
): Promise<MedicState> {
  const { data } = await client.patch<MedicState>(`/events/${eventId}/medics/${medicId}/assign`, { destination });
  return data;
}

export async function updateMedicStatus(
  eventId: string,
  medicId: string,
  status: "available" | "stationary" | "rest" | "sweeper",
): Promise<MedicState> {
  const { data } = await client.patch<MedicState>(`/events/${eventId}/medics/${medicId}/status`, { status });
  return data;
}

export async function broadcastToEvent(eventId: string, title: string, body: string): Promise<void> {
  await client.post(`/events/${eventId}/broadcast`, { title, body });
}

export async function removeActiveMedic(eventId: string, medicId: string): Promise<void> {
  await client.delete(`/events/${eventId}/medics/${medicId}/active`);
}

export async function getParticipants(eventId: string): Promise<ParticipantLastLocation[]> {
  const { data } = await client.get<ParticipantLastLocation[]>(`/events/${eventId}/participants`);
  return data;
}

export interface HeatmapPoint {
  lat: number;
  lng: number;
  recordedAt: string;
}
export interface HeatmapSnapshot {
  generatedAt: string;
  count: number;
  points: HeatmapPoint[];
}

/** Aggregated runner heatmap — one lightweight call (poll it). */
export async function getHeatmap(eventId: string): Promise<HeatmapSnapshot> {
  const { data } = await client.get<HeatmapSnapshot>(`/events/${eventId}/heatmap`);
  return data;
}
