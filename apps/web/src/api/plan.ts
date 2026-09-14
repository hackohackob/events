import type { EventPlan, VehicleType } from "@events/contracts";
import client from "./client";
import { routeProfileFor } from "@/lib/planner/travel";

/** The event's deployment plan. A never-planned event returns an empty one. */
export async function fetchPlan(eventId: string): Promise<EventPlan> {
  const { data } = await client.get<EventPlan>(`/events/${eventId}/plan`, {
    headers: { "x-event-id": eventId },
  });
  return data;
}

export async function savePlan(eventId: string, plan: EventPlan): Promise<EventPlan> {
  const { data } = await client.put<EventPlan>(`/events/${eventId}/plan`, plan, {
    headers: { "x-event-id": eventId },
  });
  return data;
}

export interface RoutedLeg {
  minutes: number;
  meters: number;
  /** `[lng, lat]` geometry, for drawing the medic's real path in the preview. */
  path: [number, number][];
}

/**
 * Measure one relocation on the routing engine. Returns null on any failure —
 * the planner falls back to its crow-flies estimate rather than blocking, so a
 * plan stays fully editable with GraphHopper down.
 */
export async function routeLeg(
  eventId: string,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  vehicleType: VehicleType,
): Promise<RoutedLeg | null> {
  try {
    const { data } = await client.post(
      "/routing/route",
      {
        profile: routeProfileFor(vehicleType),
        vehicleType,
        alternatives: 1,
        points: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      },
      { headers: { "x-event-id": eventId } },
    );
    const best = data?.routes?.[0];
    if (!best || !Number.isFinite(best.durationMs)) return null;
    return {
      minutes: Math.max(1, Math.round(best.durationMs / 60000)),
      meters: Math.round(best.distanceMeters ?? 0),
      path: (best.geometry ?? []) as [number, number][],
    };
  } catch {
    return null;
  }
}
