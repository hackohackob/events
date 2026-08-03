import { DEFAULT_VEHICLE_TYPE } from "@events/contracts";
import { apiFetch } from "../ui/api-client";
import { useRosterStore } from "../security/roster-store";
import { useSessionStore } from "../security/session-store";
import type { LngLat, RouteProfile, RouteResponse } from "./types";

/** My roster vehicle — sent with every route so the ways and times fit it. */
function myVehicleType() {
  const myId = useSessionStore.getState().userId;
  return useRosterStore.getState().medics.find((m) => m.id === myId)?.vehicleType ?? DEFAULT_VEHICLE_TYPE;
}

/**
 * Request route variants from the backend GraphHopper proxy. `points` are
 * ordered `[lng, lat]` waypoints: first is the start, last the destination, any
 * in between are via-points from route editing.
 *
 * The profile is the medic's explicit choice; `vehicleType` refines it server
 * side — an ambulance asking for "car" is kept off gravel, a motorbike asking
 * for "mtb" is quoted motorbike minutes rather than bicycle ones.
 */
export async function requestRoute(
  profile: RouteProfile,
  points: LngLat[],
  alternatives = 3,
  avoidIncomingTraffic = false,
): Promise<RouteResponse> {
  return apiFetch<RouteResponse>("/routing/route", {
    method: "POST",
    body: JSON.stringify({
      profile,
      points,
      alternatives,
      avoidIncomingTraffic,
      vehicleType: myVehicleType(),
    }),
  });
}
