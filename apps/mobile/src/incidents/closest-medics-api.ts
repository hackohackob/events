import type { ClosestMedic, ClosestMedicsResponse } from "@events/contracts";
import { apiFetch } from "../ui/api-client";

export type { ClosestMedic, ClosestMedicsResponse };

/**
 * The five medics who can reach this point soonest, each routed on their own
 * vehicle's network. Ranked by real travel time, not crow-flies distance — the
 * whole point is that the nearest dot is often not the fastest responder.
 */
export async function fetchClosestMedics(
  lat: number,
  lng: number,
  opts: { incidentId?: string } = {},
): Promise<ClosestMedicsResponse> {
  return apiFetch<ClosestMedicsResponse>("/routing/closest-medics", {
    method: "POST",
    body: JSON.stringify({ lat, lng, incidentId: opts.incidentId }),
  });
}
