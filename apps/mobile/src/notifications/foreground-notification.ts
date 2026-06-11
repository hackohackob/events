import notifee, { EventType } from "@notifee/react-native";
import { Platform } from "react-native";
import { stopLocationLoop } from "../location/location-tracker";
import { useIncidentStore } from "../incidents/incident-store";
import { useNotificationFocus } from "./notification-focus";
import { debugLog } from "../debug/debug-log";

// The persistent tracking notification is owned by expo-location's foreground
// service now (that service is what keeps updates alive after the app is
// backgrounded/swiped away — a notifee-owned service could not). This module
// keeps the notifee event handlers (incident alert taps + legacy actions) and
// the shared group id.
const NOTIFICATION_ID = "tracking-ongoing";

/** All app notifications share this group so incident/broadcast alerts stack
 *  together in the tray. */
export const NOTIFICATION_GROUP_ID = "medic-event-app";

export const NOTIF_ACTION_REPORT = "report-incident";
export const NOTIF_ACTION_STOP = "stop-tracking";

/** Remove the legacy notifee tracking notification (older builds showed one). */
export async function hideTrackingNotification(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await notifee.stopForegroundService();
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
