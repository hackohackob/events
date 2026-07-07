import * as IntentLauncher from "expo-intent-launcher";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { ensureIncidentAlarmChannel, INCIDENT_ALARM_CHANNEL_ID } from "./broadcast-notification";
import { debugLog } from "../debug/debug-log";

/**
 * Android silently strips `bypassDnd` from a notification channel while the app
 * lacks "Do Not Disturb access" (notification policy access). Reading the flag
 * back from the created channel is therefore an accurate "will the incident
 * alarm actually ring through DND?" probe.
 */
export async function isDndBypassGranted(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    // Re-apply first: once the user grants DND access, the next set call is
    // allowed to flip bypassDnd on the existing channel.
    await ensureIncidentAlarmChannel();
    const channel = await Notifications.getNotificationChannelAsync(INCIDENT_ALARM_CHANNEL_ID);
    return channel?.bypassDnd === true;
  } catch (err) {
    debugLog("app", "error", "dnd bypass probe failed", String(err));
    return false;
  }
}

/** Open the system "Do Not Disturb access" list so the user can allow the app. */
export async function openDndAccessSettings(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await IntentLauncher.startActivityAsync("android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS");
  } catch (err) {
    debugLog("app", "error", "open DND access settings failed", String(err));
  }
}
