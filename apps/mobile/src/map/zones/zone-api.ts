import type { CreateZoneRequest, EventZone, UpdateZoneRequest } from "@events/contracts";
import { apiFetch } from "../../ui/api-client";

/** Medic-only zone CRUD — the backend rejects runner/spectator sessions. */

export async function fetchZones(): Promise<EventZone[]> {
  return apiFetch<EventZone[]>("/events/zones");
}

export async function createZone(body: CreateZoneRequest): Promise<EventZone> {
  return apiFetch<EventZone>("/events/zones", { method: "POST", body: JSON.stringify(body) });
}

export async function updateZone(zoneId: string, patch: UpdateZoneRequest): Promise<EventZone> {
  return apiFetch<EventZone>(`/events/zones/${zoneId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteZone(zoneId: string): Promise<void> {
  await apiFetch(`/events/zones/${zoneId}`, { method: "DELETE" });
}
