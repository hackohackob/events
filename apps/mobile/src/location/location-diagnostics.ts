import * as ExpoLocation from "expo-location";
import { AppState, Platform } from "react-native";
import type { LocationDiagEntry, LocationDiagKind, LocationDiagUpload } from "@events/contracts";
import { apiFetch } from "../ui/api-client";
import { isOnline } from "../offline/connectivity";
import { useSessionStore } from "../security/session-store";
import { useSettingsStore, effectiveLocationIntervalMs } from "../settings/settings-store";
import { APP_VERSION } from "../debug/build-info";
import { debugLog } from "../debug/debug-log";
import { getLocationTuning } from "./location-tuning";

/**
 * Location diagnostics shipped to the server, so a coordinator can see WHY a
 * medic's dot is vague without having the phone in hand.
 *
 * Sampled, not a firehose: the tracker logs an inaccurate fix only on the way
 * into a vague spell (and then every few minutes while it lasts), every
 * re-measure outcome, every "center on me", and one ordinary fix per
 * `baselineSampleMin`. Everything here is mirrored into the on-device debug
 * log as well.
 *
 * Entries buffer in memory (a crash loses a few lines — acceptable for a
 * diagnostic) and ride out on the next moment we are online anyway.
 */
const MAX_BUFFER = 80;
const FLUSH_MIN_GAP_MS = 60_000;

const buffer: LocationDiagEntry[] = [];
let flushInFlight = false;
let lastFlushAt = 0;

/** Device + permission context, cached — it changes rarely and costs native calls. */
let contextCache: { at: number; value: Record<string, unknown> } | null = null;
const CONTEXT_TTL_MS = 60_000;

/**
 * The state that explains most vague fixes, in one object: is precise
 * location granted at all (Android "approximate", iOS "reduced accuracy" cap
 * every fix at kilometres), is the GPS provider even on, and what tier the
 * tracker is asking for.
 */
export async function locationContext(): Promise<Record<string, unknown>> {
  const settings = useSettingsStore.getState();
  const live = {
    appState: AppState.currentState,
    online: isOnline(),
    stationaryMode: settings.stationaryMode,
    intervalSec: Math.round(effectiveLocationIntervalMs() / 1000),
  };
  if (contextCache && Date.now() - contextCache.at < CONTEXT_TTL_MS) return { ...contextCache.value, ...live };

  const value: Record<string, unknown> = {};
  try {
    const fg = await ExpoLocation.getForegroundPermissionsAsync();
    value.permission = fg.status;
    // Android "coarse" = the user picked "Approximate": every fix is snapped to
    // a ~2 km grid, and no amount of re-measuring helps. iOS doesn't expose its
    // "Precise: off" equivalent; there it shows up as fixes stuck at 1–5 km.
    if (fg.android) value.precision = fg.android.accuracy;
    if (fg.ios) value.scope = fg.ios.scope;
  } catch {
    // leave it out
  }
  try {
    value.background = (await ExpoLocation.getBackgroundPermissionsAsync()).status;
  } catch {
    // leave it out
  }
  try {
    const p = await ExpoLocation.getProviderStatusAsync();
    value.servicesOn = p.locationServicesEnabled;
    if (Platform.OS === "android") {
      value.gpsProvider = p.gpsAvailable;
      value.networkProvider = p.networkAvailable;
    }
  } catch {
    // leave it out
  }
  contextCache = { at: Date.now(), value };
  return { ...value, ...live };
}

/** Human-readable reasons a phone cannot produce a precise fix at all. */
export function precisionBlockers(ctx: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (ctx.precision === "coarse") out.push("precise location permission is OFF");
  if (ctx.gpsProvider === false) out.push("GPS provider is off");
  if (ctx.servicesOn === false) out.push("location services are off");
  return out;
}

export function describeFix(location: ExpoLocation.LocationObject | null | undefined): Record<string, unknown> | undefined {
  if (!location) return undefined;
  const c = location.coords;
  return {
    accuracy: c.accuracy != null ? Math.round(c.accuracy) : null,
    ageSec: Math.round((Date.now() - location.timestamp) / 1000),
    speed: c.speed != null ? Math.round(c.speed * 10) / 10 : null,
    altAcc: c.altitudeAccuracy != null ? Math.round(c.altitudeAccuracy) : null,
    mocked: location.mocked || undefined,
  };
}

/**
 * The same failure repeats on a timer (a phone without "Always" fails every
 * silent ping, every 5 min) — upload it once per window, then say how many
 * times it recurred, instead of burying the log in identical lines.
 */
const REPEAT_WINDOW_MS = 15 * 60_000;
const repeats = new Map<string, { at: number; suppressed: number }>();

export function noteLocationDiag(
  kind: LocationDiagKind,
  level: LocationDiagEntry["level"],
  message: string,
  fields: { location?: ExpoLocation.LocationObject | null; data?: Record<string, unknown> } = {},
): void {
  try {
    // An entry that carries an error IS an error, whatever the caller judged —
    // the dashboard's error view keys on the level.
    const error = fields.data?.error as { code?: unknown; message?: unknown } | undefined;
    if (error != null) level = "error";
    debugLog("location", level, `[diag:${kind}] ${message}`, fields.data);
    if (!getLocationTuning().diagnosticsEnabled) return;
    if (level === "error") {
      const key = `${kind}:${String(error?.code ?? message)}`;
      const seen = repeats.get(key);
      if (seen && Date.now() - seen.at < REPEAT_WINDOW_MS) {
        seen.suppressed += 1;
        return;
      }
      repeats.set(key, { at: Date.now(), suppressed: 0 });
      if (seen?.suppressed) {
        message = `${message} (repeated ${seen.suppressed}× since the last entry)`;
      }
    }
    const c = fields.location?.coords;
    buffer.push({
      at: new Date().toISOString(),
      kind,
      level,
      message,
      accuracy: c?.accuracy ?? null,
      lat: c ? Math.round(c.latitude * 1e6) / 1e6 : null,
      lng: c ? Math.round(c.longitude * 1e6) / 1e6 : null,
      data: fields.data,
    });
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  } catch {
    // diagnostics must never break tracking
  }
}

function deviceLabel(): string {
  if (Platform.OS === "android") {
    const c = Platform.constants as { Brand?: string; Model?: string; Release?: string };
    return [c.Brand, c.Model, c.Release ? `Android ${c.Release}` : null].filter(Boolean).join(" ");
  }
  return `iOS ${Platform.Version}`;
}

/**
 * Upload buffered entries. Called opportunistically after a successful
 * location send (so it never wakes the radio on its own) and with `urgent`
 * after a remote precise-fix request, where the coordinator is waiting.
 */
export async function flushLocationDiagnostics(opts: { urgent?: boolean } = {}): Promise<void> {
  if (buffer.length === 0 || flushInFlight || !isOnline()) return;
  if (!opts.urgent && Date.now() - lastFlushAt < FLUSH_MIN_GAP_MS) return;
  const session = useSessionStore.getState();
  const isMedic = session.role === "medic" || session.role === "paramedic";
  if (!isMedic || !session.eventId || !session.userId) return;

  flushInFlight = true;
  lastFlushAt = Date.now();
  const batch = buffer.splice(0, buffer.length);
  const upload: LocationDiagUpload = {
    medicId: session.userId,
    name: session.name ?? undefined,
    platform: Platform.OS,
    appVersion: APP_VERSION,
    device: deviceLabel(),
    entries: batch,
  };
  try {
    await apiFetch(`/events/${session.eventId}/location-diagnostics`, {
      method: "POST",
      body: JSON.stringify(upload),
    });
  } catch {
    // Put them back (newest win if that overflows) and try on the next send.
    buffer.unshift(...batch);
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  } finally {
    flushInFlight = false;
  }
}
