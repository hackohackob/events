import client from "./client";
import type { CreateZoneRequest, EventZone, UpdateZoneRequest } from "@events/contracts";

/** Medic-only zone CRUD. All calls scope by x-event-id (see client interceptor). */

export async function listZones(eventId: string): Promise<EventZone[]> {
  const res = await client.get("/events/zones", { headers: { "x-event-id": eventId } });
  return res.data;
}

export async function createZone(eventId: string, body: CreateZoneRequest): Promise<EventZone> {
  const res = await client.post("/events/zones", body, { headers: { "x-event-id": eventId } });
  return res.data;
}

export async function updateZone(
  eventId: string,
  zoneId: string,
  patch: UpdateZoneRequest,
): Promise<EventZone> {
  const res = await client.patch(`/events/zones/${zoneId}`, patch, {
    headers: { "x-event-id": eventId },
  });
  return res.data;
}

export async function deleteZone(eventId: string, zoneId: string): Promise<void> {
  await client.delete(`/events/zones/${zoneId}`, { headers: { "x-event-id": eventId } });
}
