import type { MedicTrail } from "@events/contracts";
import type { TrailWindow } from "./trail-store";
import { apiFetch } from "../ui/api-client";
import { useSessionStore } from "../security/session-store";

function eventId(): string {
  return useSessionStore.getState().eventId ?? "event-demo";
}

/**
 * A medic's breadcrumbs. `medicId` omitted means "mine" — the server has a
 * dedicated route for that so a medic never needs to know their own id, and so
 * the request works for external guests who aren't on the roster.
 */
export async function fetchTrail(window: TrailWindow, medicId?: string): Promise<MedicTrail> {
  const suffix = medicId ? encodeURIComponent(medicId) : "me";
  // A number is a rolling lookback; "event" asks for the archive — the event's
  // own days, however long ago it ran.
  const span = window === "event" ? "window=event" : `hours=${window}`;
  // `maxPoints` is tuned down from the server default: a phone map doesn't
  // benefit from more vertices than it has pixels along the path, and the
  // payload rides a field data connection.
  return apiFetch<MedicTrail>(`/events/${eventId()}/trails/${suffix}?${span}&maxPoints=600`);
}
