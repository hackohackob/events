import type { EventPlan, VehicleType } from "@events/contracts";
import { routeProfileFor } from "@events/planner";
import { apiFetch } from "../ui/api-client";

/**
 * A course as the plan needs it: the geometry, and the discipline key the plan
 * files its schedule under. The label and colour ride along so the phone never
 * has to fetch the whole event document just to draw a legend.
 */
export interface PlanTrack {
  id: string;
  label: string;
  color?: string;
  disciplineId?: string;
  points: Array<{ lat: number; lng: number; ele?: number }>;
}

export async function fetchPlan(eventId: string): Promise<EventPlan> {
  return apiFetch<EventPlan>(`/events/${encodeURIComponent(eventId)}/plan`);
}

export async function savePlan(eventId: string, plan: EventPlan): Promise<EventPlan> {
  return apiFetch<EventPlan>(`/events/${encodeURIComponent(eventId)}/plan`, {
    method: "PUT",
    body: JSON.stringify(plan),
  });
}

export async function fetchPlanTracks(): Promise<PlanTrack[]> {
  // The event is taken from the session headers, same as the map's own fetch.
  const tracks = await apiFetch<PlanTrack[]>("/events/tracks");
  return Array.isArray(tracks) ? tracks : [];
}

/**
 * A routed leg, used to draw a medic's journey along real roads rather than
 * across country. Durations are NOT read back from this: the plan already
 * stores the minutes the desk measured, and a phone re-quoting them would make
 * the same plan read differently on two screens.
 */
export async function routePlanLeg(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  vehicleType: VehicleType,
  via: Array<{ lat: number; lng: number }> = [],
): Promise<[number, number][] | null> {
  try {
    const answer = await apiFetch<{ routes?: Array<{ geometry?: [number, number][] }> }>(
      "/routing/route",
      {
        method: "POST",
        body: JSON.stringify({
          profile: routeProfileFor(vehicleType),
          vehicleType,
          alternatives: 1,
          points: [
            [from.lng, from.lat],
            ...via.map((v) => [v.lng, v.lat]),
            [to.lng, to.lat],
          ],
        }),
      },
    );
    const geometry = answer?.routes?.[0]?.geometry;
    return Array.isArray(geometry) && geometry.length > 1 ? geometry : null;
  } catch {
    return null;
  }
}
