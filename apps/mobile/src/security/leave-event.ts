import { stopLocationLoop } from "../location/location-tracker";
import { unregisterPushToken } from "../notifications/push-registration";
import { hideTrackingNotification } from "../notifications/foreground-notification";
import { stopIncidentSiren } from "../notifications/incident-siren";
import { clearPlanNotifications } from "../plan/plan-notifications";
import { resetSocket } from "../realtime/socket-client";
import { debugLog } from "../debug/debug-log";
import { useSessionStore } from "./session-store";

/**
 * Leave the current event and put the app fully to sleep.
 *
 * Clearing the session alone used to leave almost everything running: the GPS
 * subscription and expo-location's foreground service (with its "Sharing your
 * location" notification), the heartbeat, the live socket — reconnecting
 * forever with the old token — and any plan reminders still scheduled for the
 * event just left. After this, nothing wakes the phone until the user joins
 * again.
 *
 * Each step is isolated: a failure in one must never stop the rest, and never
 * trap the user in an event they are trying to leave.
 */
export async function leaveEvent(): Promise<void> {
  debugLog("app", "info", "leaving event — stopping tracking, socket and reminders");

  // Tracking first: it is the battery, and it needs nothing from the session.
  await stopLocationLoop().catch((err) => debugLog("location", "warn", "stop tracking on leave failed", String(err)));
  await hideTrackingNotification().catch(() => undefined);
  stopIncidentSiren();

  // Unregister BEFORE clearing the session: apiFetch signs the call with the
  // session headers, and leaving must also stop the alarms for this event.
  await unregisterPushToken();
  await clearPlanNotifications();

  resetSocket();
  useSessionStore.getState().clear();
}
