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

export async function removeActiveMedic(eventId: string, medicId: string): Promise<void> {
  await client.delete(`/events/${eventId}/medics/${medicId}/active`);
}

export async function getParticipants(eventId: string): Promise<ParticipantLastLocation[]> {
  const { data } = await client.get<ParticipantLastLocation[]>(`/events/${eventId}/participants`);
  return data;
}
