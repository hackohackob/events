import * as ExpoLocation from "expo-location";
import { distanceMeters, formatDistance } from "../navigation/geo";

function titleCase(value: string): string {
  const v = value.trim();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Human, per-recipient body for an incident alert: the category (incident type)
 * and — when we have a recent fix for this device — how far the incident is from
 * the medic right now. "Distance from me" is recipient-specific, so it can only
 * be computed here on the device, never on the backend. Falls back to just the
 * category when no location is available (e.g. permission off, app cold).
 */
export async function incidentNotificationBody(opts: {
  type?: string | null;
  lat?: unknown;
  lng?: unknown;
}): Promise<string> {
  const category = titleCase(String(opts.type ?? "").trim() || "Incident");
  const lat = toFiniteNumber(opts.lat);
  const lng = toFiniteNumber(opts.lng);
  if (lat === null || lng === null) return category;
  try {
    // getLastKnownPositionAsync returns the OS-cached fix without prompting or
    // powering up the GPS — safe to call from the headless background task.
    const pos = await ExpoLocation.getLastKnownPositionAsync();
    if (pos) {
      const meters = distanceMeters(
        { lat: pos.coords.latitude, lng: pos.coords.longitude },
        { lat, lng },
      );
      if (Number.isFinite(meters)) return `${category} • ${formatDistance(meters)} away`;
    }
  } catch {
    // no location → category only
  }
  return category;
}
