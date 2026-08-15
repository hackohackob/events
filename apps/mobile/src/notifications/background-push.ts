import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { shouldRaiseIncidentAlarm } from "./incident-alarm-guard";
import { playIncidentSiren } from "./incident-siren";
import { debugLog } from "../debug/debug-log";

export const BACKGROUND_PUSH_TASK = "background-push-task";

/**
 * Pull our payload out of whatever shape the headless FCM delivery hands us.
 * Expo's push service packs the message's `data` into an FCM data message; on
 * Android the custom fields arrive JSON-stringified under a `body` key.
 */
function extractPushData(raw: unknown): Record<string, string> | null {
  const candidate =
    (raw as { notification?: { data?: unknown } })?.notification?.data ??
    (raw as { data?: unknown })?.data ??
    raw;
  if (!candidate || typeof candidate !== "object") return null;
  const record = candidate as Record<string, unknown>;
  if (typeof record.body === "string" && record.body.trim().startsWith("{")) {
    try {
      return { ...record, ...JSON.parse(record.body) } as Record<string, string>;
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
 * Two kinds arrive here and they are handled very differently:
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
