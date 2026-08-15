import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { apiFetch } from "../ui/api-client";
import { useNotificationFocus } from "./notification-focus";
import { registerBackgroundPushTask } from "./background-push";
import { ensureIncidentAlarmChannel } from "./broadcast-notification";
import { debugLog } from "../debug/debug-log";

/**
 * Route taps on REMOTE (Expo push) notifications into the same map-focus flow
 * as local notifee taps: an incidentId in the push data focuses the incident.
 * Also replays the tap that launched the app from a killed state.
 */
export function registerPushTapHandler(): () => void {
  const handle = (response: Notifications.NotificationResponse | null) => {
    const data = response?.notification.request.content.data as Record<string, unknown> | undefined;
    const incidentId = typeof data?.incidentId === "string" ? data.incidentId : undefined;
    if (incidentId) useNotificationFocus.getState().focusIncident(incidentId);
  };
  void Notifications.getLastNotificationResponseAsync().then(handle);
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}

/**
 * Tell the backend to forget this device, so it stops receiving incident
 * alarms for the event being left. Must run while the session is still active —
 * apiFetch needs the auth headers — so call this BEFORE clearing the session.
 *
 * Never throws, and gives up after `timeoutMs` so a phone on the edge of
 * coverage doesn't freeze the leave behind apiFetch's 15s radio cap. The
 * request keeps running after we stop waiting; if it never lands, the row
 * survives server-side and the dashboard's Devices page can clear it.
 */
export async function unregisterPushToken(timeoutMs = 4000): Promise<void> {
  const send = async () => {
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId,
    });
    await apiFetch("/notifications/token/unregister", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    debugLog("app", "info", "push token unregistered — device will not be alarmed");
  };

  const timedOut = Symbol("timeout");
  try {
    const result = await Promise.race([
      send(),
      new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), timeoutMs)),
    ]);
    if (result === timedOut) {
      debugLog("app", "warn", "push unregister still in flight — leaving anyway");
    }
  } catch (err) {
    debugLog("app", "warn", "push token unregister failed; clear it from the dashboard", String(err));
  }
}

/**
 * Request notification permissions and register the Expo push token
 * with the backend. Call this once after the user has joined an event.
 */
export async function registerPushToken(): Promise<void> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    debugLog("app", "warn", "push registration skipped — notification permission not granted");
    return;
  }

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId,
    });
    token = result.data;
  } catch (err) {
    // On Android this is almost always missing FCM credentials
    // (google-services.json not bundled / FCM key not on the Expo project).
    // Without a token the backend can never push to this device, so closed-app
    // notifications will not work — surface it loudly.
    console.warn("[push-registration] getExpoPushTokenAsync failed:", err);
    debugLog("app", "error", "push token unavailable — closed-app alerts will NOT work", String(err));
    return;
  }
  debugLog("app", "info", "expo push token obtained", token.slice(0, 24));

  // Configure Android channels. The alarm channel matches the id the backend
  // targets for incident pushes, so closed-app deliveries ring and vibrate
  // (and bypass DND once the user allows it) like local alarms. Created via
  // the single shared helper so the channel always gets ALARM-stream audio
  // attributes (channel audio config is immutable after first creation).
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#22c55e",
    });
    await ensureIncidentAlarmChannel();
  }

  // Data-only incident alarms are rendered by our background task (looping
  // notifee alarm) instead of the OS — register the task so FCM wakes us.
  await registerBackgroundPushTask();

  // Register with backend
  try {
    await apiFetch("/notifications/token", {
      method: "POST",
      body: JSON.stringify({
        token,
        platform: "expo",
        deviceId: Constants.deviceName ?? undefined,
      }),
    });
    debugLog("app", "info", "push token registered with backend");
  } catch (err) {
    debugLog("app", "error", "push token backend registration failed", String(err));
  }
}
