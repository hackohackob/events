import notifee, { AndroidCategory, AndroidGroupAlertBehavior, AndroidImportance, AndroidVisibility } from "@notifee/react-native";
import { AppState, Platform } from "react-native";
import { NOTIFICATION_GROUP_ID } from "./foreground-notification";
import { debugLog } from "../debug/debug-log";

const ALERT_CHANNEL_ID = "alerts";
/**
 * Alarm-grade channel for incident alerts: max importance, bypasses Do Not
 * Disturb (honored once the user allows it for the app/channel), strong
 * vibration. The backend sends remote pushes on this same channel id so
 * closed-app deliveries behave identically.
 */
export const INCIDENT_ALARM_CHANNEL_ID = "incident-alarm-v4";
let channelsEnsured = false;

async function ensureChannels(): Promise<void> {
  if (channelsEnsured || Platform.OS !== "android") return;
  await notifee.createChannel({
    id: ALERT_CHANNEL_ID,
    name: "Alerts & Broadcasts",
    importance: AndroidImportance.HIGH, // heads-up + sound
    visibility: AndroidVisibility.PUBLIC,
  });
  await notifee.createChannel({
    id: INCIDENT_ALARM_CHANNEL_ID,
    name: "Incident alarms",
    description: "Critical incident alerts — rings and vibrates even in Do Not Disturb.",
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    bypassDnd: true,
    // Bundled siren (assets/sounds/incident_alarm.wav → res/raw) — plays for
    // remote pushes too, where a looping sound isn't possible.
    sound: "incident_alarm",
    vibration: true,
    vibrationPattern: [300, 600, 300, 600, 300, 600],
    lights: true,
  });
  channelsEnsured = true;
}

/**
 * Present a heads-up OS notification for a dashboard broadcast or incident alarm.
 * Uses notifee directly so it fires even while the app is foregrounded and needs
 * no push token / FCM setup.
 *
 * `alarm: true` turns it into an incident alarm: alarm channel (DND bypass),
 * looping sound that keeps ringing until the notification is opened or
 * dismissed, and full-screen prominence on the lock screen.
 */
export async function showBroadcastNotification(
  title: string,
  body: string,
  data?: Record<string, string>,
  alarm = false,
): Promise<void> {
  try {
    // While the app is open we still surface the alert as a heads-up
    // notification, but drop the insistent looping siren + full-screen takeover
    // (those are meant for when the phone is pocketed/locked). Otherwise a new
    // incident arriving with the app foregrounded would show nothing at all.
    const foregrounded = AppState.currentState === "active";
    const insistent = alarm && !foregrounded;
    if (alarm && foregrounded) {
      debugLog("app", "info", "foreground incident alert (non-insistent)", data?.incidentId ?? title);
    }
    await notifee.requestPermission();
    await ensureChannels();
    await notifee.displayNotification({
      // Stable id per incident: the socket path and the data-only push path can
      // both fire for the same incident — the second display replaces the
      // first instead of stacking a duplicate.
      id: data?.incidentId ? `incident-${data.incidentId}` : undefined,
      title,
      body,
      data,
      android: {
        channelId: alarm ? INCIDENT_ALARM_CHANNEL_ID : ALERT_CHANNEL_ID,
        color: alarm ? "#ef4444" : "#f59e0b",
        smallIcon: "ic_launcher",
        // Stack under the persistent tracking notification (the group summary)
        // instead of piling up as separate tray entries.
        groupId: NOTIFICATION_GROUP_ID,
        groupAlertBehavior: AndroidGroupAlertBehavior.CHILDREN,
        pressAction: { id: "default", launchActivity: "default" },
        ...(alarm
          ? {
              category: AndroidCategory.ALARM,
              // The bundled siren is itself ~30s long, so a single play already
              // rings for the full window. We deliberately do NOT loop it
              // (FLAG_INSISTENT): looping would ring forever until dismissed, and
              // capping that with `timeoutAfter` would also remove the incident
              // from the tray. Playing the 30s file once stops the sound on its
              // own while leaving the notification in place.
              loopSound: false,
              autoCancel: true,
              ongoing: false,
              // Light up / take over the lock screen like an incoming call —
              // only worthwhile when the app isn't already in the foreground.
              ...(insistent ? { fullScreenAction: { id: "default", launchActivity: "default" } } : {}),
            }
          : {}),
      },
      ios: { sound: "default", critical: alarm },
    });
  } catch (err) {
    // Surface to Metro (debugLog only writes to the in-app console).
    console.warn("[broadcast-notification] failed:", err);
    debugLog("app", "error", "broadcast notification failed", String(err));
  }
}
