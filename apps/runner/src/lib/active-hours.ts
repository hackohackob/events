import type { EventActiveHours } from "../api/contracts-shim";

/** "HH:mm" in the event's timezone regardless of the device timezone. */
const SOFIA_HHMM = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Sofia",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * True when `now` falls inside the event's daily active-hours window.
 * Events without a window are always active; overnight windows (end < start)
 * span midnight. Mirrors the server-side check — this is only a client-side
 * belt-and-braces (the API already returns no medics outside the window).
 */
export function isWithinActiveHours(
  activeHours: EventActiveHours | undefined,
  now: Date = new Date(),
): boolean {
  if (!activeHours) return true;
  const hm = SOFIA_HHMM.format(now);
  return activeHours.start <= activeHours.end
    ? hm >= activeHours.start && hm <= activeHours.end
    : hm >= activeHours.start || hm <= activeHours.end;
}
