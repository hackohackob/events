import type { EventPlan, VehicleType } from "@events/contracts";
import client from "./client";
import { routeProfileFor } from "@events/planner";

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
  via: Array<{ lat: number; lng: number }> = [],
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
          ...via.map(v => [v.lng, v.lat] as [number, number]),
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

export interface IsochroneResult {
  /** Which networks answered — a vehicle may be able to use more than one. */
  profiles: string[];
  /**
   * Innermost bucket first. Each bucket holds one ring per network the vehicle
   * can use, so a point is reachable in that bucket if ANY of them contains it.
   */
  buckets: Array<Array<Array<[number, number]>>>;
}

/**
 * Everywhere a vehicle can reach from a point inside `minutes`.
 *
 * Measured out to TWICE the budget in six slices. Asked for the budget alone,
 * the outermost ring is a cliff: somewhere eleven minutes away is drawn exactly
 * like somewhere an hour away, and a village just past the contour reads as
 * unreachable. The back three slices grade how far past the budget a place is,
 * for the cost of the same single request.
 *
 * Null on any failure — the planner falls back to a plain radius rather than
 * showing nothing, so a plan stays workable with the routing engine down.
 */
export async function fetchIsochrone(
  eventId: string,
  point: { lat: number; lng: number },
  vehicleType: VehicleType,
  minutes: number,
): Promise<IsochroneResult | null> {
  try {
    const { data } = await client.post<IsochroneResult>(
      "/routing/isochrone",
      { lat: point.lat, lng: point.lng, vehicleType, minutes: minutes * 2, buckets: 6 },
      { headers: { "x-event-id": eventId } },
    );
    return data?.buckets?.length ? data : null;
  } catch {
    return null;
  }
}
