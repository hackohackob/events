import { apiFetch } from "../ui/api-client";
import type { LngLat, RouteProfile, RouteResponse } from "./types";

/**
 * Request route variants from the backend GraphHopper proxy. `points` are
 * ordered `[lng, lat]` waypoints: first is the start, last the destination, any
 * in between are via-points from route editing.
 */
export async function requestRoute(
  profile: RouteProfile,
  points: LngLat[],
  alternatives = 3,
): Promise<RouteResponse> {
  return apiFetch<RouteResponse>("/routing/route", {
    method: "POST",
    body: JSON.stringify({ profile, points, alternatives }),
  });
}
