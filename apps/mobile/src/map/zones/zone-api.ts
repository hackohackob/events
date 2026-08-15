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

/** Coordinator-only: turn this zone on for every team device (see
 *  zone-visibility-store for how devices apply it). */
export async function broadcastZone(zoneId: string): Promise<EventZone> {
  return apiFetch<EventZone>(`/events/zones/${zoneId}/broadcast`, { method: "POST" });
}

export async function deleteZone(zoneId: string): Promise<void> {
  await apiFetch(`/events/zones/${zoneId}`, { method: "DELETE" });
}
