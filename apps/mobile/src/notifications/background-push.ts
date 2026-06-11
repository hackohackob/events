import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { showBroadcastNotification } from "./broadcast-notification";

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
 * Handles DATA-ONLY pushes (incident alarms) — the backend deliberately sends
 * these without title/body so the OS shows nothing, and we raise a full notifee
 * alarm instead: looping sound, strong vibration, DND bypass, full-screen.
 * Works with the app backgrounded or killed (headless JS).
 *
 * MUST be defined at module load, before the app mounts.
 */
TaskManager.defineTask(BACKGROUND_PUSH_TASK, async ({ data, error }) => {
  if (error) return;
  const payload = extractPushData(data);
  if (!payload) return;
  const title = payload.title ?? "🚨 Incident";
  const body = payload.body ?? "";
  await showBroadcastNotification(
    title,
    body,
    payload.incidentId ? { incidentId: String(payload.incidentId) } : undefined,
    true,
  );
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
