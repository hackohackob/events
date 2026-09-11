import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { shouldRaiseIncidentAlarm } from "./incident-alarm-guard";
import { playIncidentSiren } from "./incident-siren";
import { debugLog } from "../debug/debug-log";
import { ensureTrackingAlive, sendCurrentLocationNow } from "../location/location-tracker";
import { useSessionStore } from "../security/session-store";
import { useSettingsStore } from "../settings/settings-store";

export const BACKGROUND_PUSH_TASK = "background-push-task";

/**
 * Pull our payload out of whatever shape the headless delivery hands us.
 *
 * Expo's push service packs the message's `data` under a `body` key on BOTH
 * platforms, but in different types: Android's FCM data message can only carry
 * strings, so it arrives JSON-stringified, while iOS keeps it as a real object
 * (expo-notifications' BackgroundEventTransformer produces
 * `{ notification: null, aps, data: { body, dataString, … } }`).
 *
 * Missing the object case is not cosmetic: `kind` lives inside `body`, so
 * without it every field we branch on reads as undefined on iPhone.
 */
function extractPushData(raw: unknown): Record<string, string> | null {
  const candidate =
    (raw as { notification?: { data?: unknown } })?.notification?.data ??
    (raw as { data?: unknown })?.data ??
    raw;
  if (!candidate || typeof candidate !== "object") return null;
  const record = candidate as Record<string, unknown>;
  const body = record.body;
  if (body && typeof body === "object") {
    return { ...record, ...(body as Record<string, unknown>) } as Record<string, string>;
  }
  if (typeof body === "string" && body.trim().startsWith("{")) {
    try {
      return { ...record, ...JSON.parse(body) } as Record<string, string>;
    } catch {
      // fall through — treat fields as-is
    }
  }
  return record as Record<string, string>;
}

/**
 * Background handler for remote pushes, running even when the app is killed
 * (headless JS).
 *
 * Three kinds arrive here and they are handled very differently:
 *
 * `location_ping` is the exception to everything below: it is a genuinely
 * silent, data-only push that carries no notification at all, and it exists
 * solely to wake a suspended app long enough to report its position.
 *
 * Everything the backend sends is a NOTIFICATION payload, so Android has always
 * already drawn it by the time this runs and the task must never draw anything
 * itself. What it is still good for is sounding the siren, which a notification
 * cannot do on a phone set to vibrate.
 *
 * MUST be defined at module load, before the app mounts.
 */
TaskManager.defineTask(BACKGROUND_PUSH_TASK, async ({ data, error }) => {
  if (error) return;
  const payload = extractPushData(data);
  if (!payload) return;

  // Chat is sent as a notification payload and drawn by the OS, so there is
  // nothing to do here — drawing it again would duplicate it, and it must not
  // fall through to the incident path below.
  if (payload.kind === "chat_message") return;

  // ── The silent wake-up ──
  // iOS suspends a backgrounded app once the OS stops handing it fixes, and a
  // suspended runtime runs no timers — the heartbeat and the tracking watchdog
  // are both frozen, so a medic standing still simply goes dark and nothing in
  // the app can notice. The backend watches for that silence and sends this
  // ping, which is the one thing that reaches a suspended app.
  //
  // It is delivered with content-available and no title/body, so nothing is
  // shown and nothing sounds — and nothing may be drawn here either. All it
  // does is report where we are and make sure tracking is still wired up; iOS
  // gives roughly 30 s for both.
  if (payload.kind === "location_ping") {
    debugLog("location", "info", "silent location ping received — reporting position", {
      sentAt: payload.sentAt,
    });
    // The push can also relaunch a TERMINATED app straight into this handler,
    // and that starts a bare JS runtime: App.tsx never mounts, so nothing has
    // read the session or the settings off disk. Without this the send has no
    // event to report to and bails. Hydration is a no-op once it has happened.
    if (!useSessionStore.getState().hydrated) await useSessionStore.getState().hydrate();
    if (!useSettingsStore.getState().hydrated) await useSettingsStore.getState().hydrate();
    await sendCurrentLocationNow();
    await ensureTrackingAlive();
    // Tell iOS the wake produced something. An app that always reports "no
    // data" gets its background pushes throttled, and this one is the whole
    // reason a stationary medic stays on the map. The literal is
    // BackgroundNotificationResult.NewData, which this version of
    // expo-notifications does not re-export from its entry point.
    return 2;
  }

  // Skip incidents reported before the app/process came up — opening the app
  // (which can trigger a queued push delivery) must not ring for old incidents.
  // Assignment pushes are always live, so they bypass the age check.
  const isAssignedPush = payload.kind === "incident_assigned";
  if (
    !isAssignedPush &&
    !(await shouldRaiseIncidentAlarm({
      incidentId: payload.incidentId,
      createdAt: payload.createdAt,
    }))
  ) {
    return;
  }

  // ── Why this does NOT display anything ──
  // Incident and assignment pushes are sent as a NOTIFICATION payload (not
  // data-only), because data-only delivery proved unreliable on some OEMs when
  // the app is killed — and an incident alarm is the one thing that must always
  // arrive. That means Android has already drawn the notification by the time
  // this task runs. Raising a notifee alert here too is what produced the
  // duplicate alarm: two different renderers, two tray entries, two sounds.
  //
  //
  // What IS still worth doing is sounding the siren ourselves. A notification's
  // sound is suppressed by the ringer on silent/vibrate whatever the channel
  // says; audio the app plays is not (see incident-siren.ts).
  debugLog("app", "info", "incident push received (OS-rendered)", {
    kind: payload.kind,
    incidentId: payload.incidentId,
  });
  await playIncidentSiren();
});

/** Register the task with expo-notifications so FCM data messages reach it. */
export async function registerBackgroundPushTask(): Promise<void> {
  try {
    await Notifications.registerTaskAsync(BACKGROUND_PUSH_TASK);
  } catch {
    // iOS / unsupported environments — remote alarms just fall back to nothing
    // extra; local socket alerts still work.
  }
}
