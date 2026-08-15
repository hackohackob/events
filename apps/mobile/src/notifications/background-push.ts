import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { showBroadcastNotification } from "./broadcast-notification";
import { incidentNotificationBody } from "./incident-notification";
import { shouldRaiseIncidentAlarm } from "./incident-alarm-guard";
import { pushChatMessageNotification } from "./chat-notification";

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
 * Handles DATA-ONLY pushes (incident alarms, chat) — the backend deliberately sends
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

  // Team chat: folded into a single running notification rather than one tray
  // entry per message. Rendered here (not by the OS) because Expo's push API
  // has no way to group or replace an Android notification — only notifee does.
  if (payload.kind === "chat_message") {
    await pushChatMessageNotification({
      messageId: payload.messageId ? String(payload.messageId) : undefined,
      authorName: payload.chatAuthor ? String(payload.chatAuthor) : undefined,
      preview: payload.chatPreview ? String(payload.chatPreview) : undefined,
    });
    return;
  }

  // Compose the user-facing text from the structured fields the backend sends
  // (incidentName/incidentType/lat/lng). We deliberately do NOT fall back to
  // payload.body: on Android that arrives as the raw JSON-stringified data blob,
  // which is what used to leak into the notification.
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

  const name = payload.incidentName ? String(payload.incidentName) : undefined;
  const assigned = payload.kind === "incident_assigned";
  const title = name
    ? `${assigned ? "🚑 Assigned: " : "🚨 "}${name}`
    : assigned
      ? "🚑 Incident assigned"
      : "🚨 Incident";
  const body = await incidentNotificationBody({
    type: payload.incidentType,
    lat: payload.lat,
    lng: payload.lng,
  });
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
