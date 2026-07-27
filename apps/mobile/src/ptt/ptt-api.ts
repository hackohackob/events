import type {
  PttChannelKind,
  PttEventRoutes,
  PttProviderStatus,
  PttRoute,
} from "@events/contracts";
import { apiFetch } from "../ui/api-client";

export type { PttChannelKind, PttEventRoutes, PttProviderStatus, PttRoute };

/** Live connection state of each bridge — read-only for the field app. */
export function fetchPttStatuses(): Promise<PttProviderStatus[]> {
  return apiFetch<PttProviderStatus[]>("/ptt/status");
}

/** Forwarding switches for the caller's own event. */
export function fetchPttRoutes(): Promise<PttEventRoutes> {
  return apiFetch<PttEventRoutes>("/ptt/routes");
}

export function setPttRoute(
  kind: PttChannelKind,
  patch: { inbound?: boolean; outbound?: boolean },
): Promise<PttEventRoutes> {
  return apiFetch<PttEventRoutes>("/ptt/routes", {
    method: "PUT",
    body: JSON.stringify({ kind, ...patch }),
  });
}
