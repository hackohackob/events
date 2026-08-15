import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { ensureAlarmStreamVolume } from "./broadcast-notification";
import { shouldRaiseIncidentAlarm } from "./incident-alarm-guard";
import { pushChatMessageNotification } from "./chat-notification";
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
 *  - CHAT is sent data-only, so nothing is on screen until this task draws it.
 *    It renders through notifee so a burst can be folded into one entry.
 *  - INCIDENT alarms are sent as a notification payload and have ALREADY been
 *    drawn by Android before this runs. This task must not draw them again.
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
  // What is still worth doing is forcing the alarm stream up, so the siren the
  // OS is playing on the alarm channel is actually audible.
  debugLog("app", "info", "incident push received (OS-rendered)", {
    kind: payload.kind,
    incidentId: payload.incidentId,
  });
  await ensureAlarmStreamVolume();
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
