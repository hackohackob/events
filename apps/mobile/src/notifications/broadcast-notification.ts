import notifee, { AndroidImportance, AndroidVisibility } from "@notifee/react-native";
import { Platform } from "react-native";
import { debugLog } from "../debug/debug-log";

const ALERT_CHANNEL_ID = "alerts";
let alertChannelEnsured = false;

async function ensureAlertChannel(): Promise<void> {
  if (alertChannelEnsured || Platform.OS !== "android") return;
  await notifee.createChannel({
    id: ALERT_CHANNEL_ID,
    name: "Alerts & Broadcasts",
    importance: AndroidImportance.HIGH, // heads-up + sound
    visibility: AndroidVisibility.PUBLIC,
  });
  alertChannelEnsured = true;
}

/**
 * Present a heads-up OS notification for a dashboard broadcast or incident alarm.
 * Uses notifee directly so it fires even while the app is foregrounded and needs
 * no push token / FCM setup. Mirrors the (working) tracking-notification config.
 */
export async function showBroadcastNotification(
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  try {
    await notifee.requestPermission();
    await ensureAlertChannel();
    await notifee.displayNotification({
      title,
      body,
      data,
      android: {
        channelId: ALERT_CHANNEL_ID,
        color: "#f59e0b",
        smallIcon: "ic_launcher",
        pressAction: { id: "default", launchActivity: "default" },
      },
      ios: { sound: "default" },
    });
  } catch (err) {
    // Surface to Metro (debugLog only writes to the in-app console).
    console.warn("[broadcast-notification] failed:", err);
    debugLog("app", "error", "broadcast notification failed", String(err));
  }
}
