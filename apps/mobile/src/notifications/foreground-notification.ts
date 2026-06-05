import notifee, { AndroidImportance, AndroidVisibility, EventType } from "@notifee/react-native";
import { Platform } from "react-native";
import { stopLocationLoop } from "../location/location-tracker";
import { useIncidentStore } from "../incidents/incident-store";
import { useNotificationFocus } from "./notification-focus";
import { debugLog } from "../debug/debug-log";

const CHANNEL_ID = "tracking";
const NOTIFICATION_ID = "tracking-ongoing";

export const NOTIF_ACTION_REPORT = "report-incident";
export const NOTIF_ACTION_STOP = "stop-tracking";

let channelEnsured = false;

async function ensureChannel(): Promise<void> {
  if (channelEnsured || Platform.OS !== "android") return;
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: "Location tracking",
    importance: AndroidImportance.LOW, // quiet, persistent
    visibility: AndroidVisibility.PUBLIC,
  });
  channelEnsured = true;
}

/**
 * Show a persistent ongoing notification with "Report incident" and "Stop
 * tracking" action buttons. Stays in the tray while the app collects location
 * in the background.
 */
export async function showTrackingNotification(isMedic: boolean): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await ensureChannel();
    await notifee.requestPermission();
    await notifee.displayNotification({
      id: NOTIFICATION_ID,
      title: "Paramedic Event App",
      body: isMedic
        ? "Sharing your location with the command centre"
        : "Sharing location with event coordinators",
      android: {
        channelId: CHANNEL_ID,
        ongoing: true,
        autoCancel: false,
        onlyAlertOnce: true,
        color: "#00C37A",
        smallIcon: "ic_launcher", // always present in an Expo Android build
        pressAction: { id: "default", launchActivity: "default" },
        actions: [
          {
            title: "Report incident",
            pressAction: { id: NOTIF_ACTION_REPORT, launchActivity: "default" },
          },
          {
            title: "Stop tracking",
            pressAction: { id: NOTIF_ACTION_STOP },
          },
        ],
      },
    });
    debugLog("app", "info", "tracking notification shown");
  } catch (err) {
    debugLog("app", "error", "failed to show tracking notification", String(err));
  }
}

export async function hideTrackingNotification(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await notifee.cancelNotification(NOTIFICATION_ID);
  } catch {
    // ignore
  }
}

/** Shared handler for both foreground and background notifee events. */
async function handleNotifeeEvent({ type, detail }: { type: EventType; detail: any }): Promise<void> {
  // Tapping the notification body (not an action button) → focus the incident.
  if (type === EventType.PRESS) {
    const incidentId = detail.notification?.data?.incidentId as string | undefined;
    if (incidentId) {
      debugLog("app", "info", "incident notification pressed", incidentId);
      useNotificationFocus.getState().focusIncident(incidentId);
    }
    return;
  }

  if (type !== EventType.ACTION_PRESS) return;
  const actionId = detail.pressAction?.id;

  if (actionId === NOTIF_ACTION_STOP) {
    debugLog("app", "info", "stop-tracking pressed from notification");
    await stopLocationLoop();
    await hideTrackingNotification();
  } else if (actionId === NOTIF_ACTION_REPORT) {
    debugLog("app", "info", "report-incident pressed from notification");
    // App is launched to the foreground; the App effect picks this up and
    // starts the report flow (which needs UI/permission prompts).
    useIncidentStore.getState().requestReport();
  }
}

/**
 * When the app is launched from a killed state by tapping an incident
 * notification, replay the focus once on startup.
 */
export async function consumeInitialNotification(): Promise<void> {
  try {
    const initial = await notifee.getInitialNotification();
    const incidentId = initial?.notification?.data?.incidentId as string | undefined;
    if (incidentId) {
      useNotificationFocus.getState().focusIncident(incidentId);
    }
  } catch {
    // ignore
  }
}

/**
 * Register notifee event handlers. The background handler MUST be registered at
 * module load (before the app fully mounts) so taps work when the app is killed.
 */
export function registerNotificationHandlers(): () => void {
  notifee.onBackgroundEvent(handleNotifeeEvent);
  const unsubscribe = notifee.onForegroundEvent(handleNotifeeEvent);
  return unsubscribe;
}
