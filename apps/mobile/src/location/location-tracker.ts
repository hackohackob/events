import * as ExpoLocation from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Battery from "expo-battery";
import { apiFetch } from "../ui/api-client";
import { getSocket } from "../realtime/socket-client";
import { useSessionStore } from "../security/session-store";
import { OfflineQueue } from "../offline/offline-queue";
import { debugLog } from "../debug/debug-log";
import { useLocationStatus } from "../debug/location-status";

export const LOCATION_TASK_NAME = "background-location-task";

const locationQueue = new OfflineQueue<Record<string, unknown>>();

async function readBatteryLevel(): Promise<number | undefined> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level >= 0 ? level : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Send a single location fix to the server. Shared by the background task and
 * the one-shot send fired when the app launches. Records outcome to the debug
 * log and the location-status store so the Location tab can surface it.
 */
async function sendLocation(location: ExpoLocation.LocationObject): Promise<void> {
  const session = useSessionStore.getState();
  const isMedic = session.role === "medic" || session.role === "paramedic";
  const battery = await readBatteryLevel();

  useLocationStatus.getState().setFix({
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    accuracy: location.coords.accuracy ?? undefined,
    battery,
    at: Date.now(),
  });

  if (isMedic) {
    const payload = {
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy: location.coords.accuracy ?? undefined,
      speed: location.coords.speed ?? undefined,
      heading: location.coords.heading ?? undefined,
      battery,
    };

    const socket = getSocket();
    if (socket.connected) {
      socket.emit("medic_location", payload);
      debugLog("location", "info", "medic location sent via WS", { accuracy: payload.accuracy, battery });
      useLocationStatus.getState().setReport({ at: Date.now(), ok: true, via: "ws" });
      return;
    }

    const eventId = session.eventId ?? "";
    const medicId = session.userId ?? "";
    try {
      await apiFetch(`/events/${eventId}/medics/${medicId}/location`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      debugLog("location", "info", "medic location sent via HTTP", { accuracy: payload.accuracy, battery });
      useLocationStatus.getState().setReport({ at: Date.now(), ok: true, via: "http" });
    } catch (err) {
      locationQueue.enqueue("medic_location", { ...payload, eventId, medicId });
      debugLog("location", "error", "medic location send failed — queued", String(err));
      useLocationStatus.getState().setReport({ at: Date.now(), ok: false, via: "queue", error: String(err) });
    }
    return;
  }

  // Participant / runner
  const eventId = session.eventId ?? "";
  const payload = {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    accuracy: location.coords.accuracy ?? undefined,
    battery,
    timestamp: new Date(location.timestamp).toISOString(),
  };
  try {
    await apiFetch(`/events/${eventId}/location`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    debugLog("location", "info", "participant location sent", { accuracy: payload.accuracy, battery });
    useLocationStatus.getState().setReport({ at: Date.now(), ok: true, via: "http" });
  } catch (err) {
    locationQueue.enqueue("location.update", payload);
    debugLog("location", "error", "participant location send failed — queued", String(err));
    useLocationStatus.getState().setReport({ at: Date.now(), ok: false, via: "queue", error: String(err) });
  }
}

// ─── Background task definition ──────────────────────────────────────────────
// Must be defined at module level (before registerRootComponent) so the native
// side can wake the JS runtime and find the task handler.

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: any) => {
  if (error) {
    console.warn("[LocationTask] error:", error.message);
    debugLog("location", "error", "background task error", error.message);
    return;
  }

  const locations: ExpoLocation.LocationObject[] = data?.locations ?? [];
  if (!locations.length) return;

  const location = locations[locations.length - 1]!;
  const session = useSessionStore.getState();
  if (session.role !== "medic" && session.role !== "paramedic" && !session.eventId) return;

  await sendLocation(location);
});

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Capture a fix immediately and send it. The background updates task is
 * interval/distance-gated, so on a fresh launch nothing is reported until the
 * device moves — this guarantees an immediate position on app open.
 */
export async function sendCurrentLocationNow(): Promise<void> {
  try {
    const permission = await ExpoLocation.getForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      debugLog("location", "warn", "one-shot send skipped — no foreground permission");
      return;
    }
    const location =
      (await ExpoLocation.getLastKnownPositionAsync()) ??
      (await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced }));
    if (location) {
      await sendLocation(location);
    }
  } catch (err) {
    debugLog("location", "error", "one-shot send failed", String(err));
  }
}

export async function startLocationLoop(): Promise<void> {
  const session = useSessionStore.getState();
  const isMedic = session.role === "medic" || session.role === "paramedic";

  // 1. Foreground permission (required before asking for background)
  const { status: fgStatus } = await ExpoLocation.requestForegroundPermissionsAsync();
  if (fgStatus !== "granted") {
    console.warn("[LocationTracker] foreground location permission denied");
    debugLog("location", "error", "foreground location permission denied");
    return;
  }

  // 2. Background permission (Android shows a system dialog)
  const { status: bgStatus } = await ExpoLocation.requestBackgroundPermissionsAsync();
  if (bgStatus !== "granted") {
    console.warn("[LocationTracker] background location permission denied — updates will stop when app is backgrounded");
    debugLog("location", "warn", "background location permission denied");
  }

  // 3. Stop any previously running task before (re)starting
  const running = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (running) {
    await ExpoLocation.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }

  // 4. Start continuous background updates
  await ExpoLocation.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: isMedic ? ExpoLocation.Accuracy.Balanced : ExpoLocation.Accuracy.Low,
    timeInterval: isMedic ? 30_000 : 60_000,   // ms between updates
    // distanceInterval 0 for medics → purely time-based, so a stationary medic
    // still reports on the timer instead of waiting to physically move.
    distanceInterval: isMedic ? 0 : 50,        // min metres between updates
    // Android foreground service — keeps the task alive and shows a notification
    foregroundService: {
      notificationTitle: "Paramedic Event App",
      notificationBody: isMedic
        ? "Sharing your location with the event command centre"
        : "Sharing location with event coordinators",
      notificationColor: "#00C37A",
    },
    // iOS: show the blue location indicator when in background
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
  });
  debugLog("location", "info", "background location updates started", { isMedic });

  // 5. Fire an immediate one-shot send so the map shows a position right away.
  void sendCurrentLocationNow();
}

export async function stopLocationLoop(): Promise<void> {
  const running = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (running) {
    await ExpoLocation.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    debugLog("location", "info", "background location updates stopped");
  }
}

export async function flushLocationQueue(): Promise<void> {
  const session = useSessionStore.getState();
  const eventId = session.eventId ?? "";
  const ready = locationQueue.listReady();
  for (const item of ready) {
    try {
      const url = item.type === "medic_location"
        ? `/events/${eventId}/medics/${(item.payload as any).medicId}/location`
        : `/events/${eventId}/location`;
      await apiFetch(url, { method: "POST", body: JSON.stringify(item.payload) });
      locationQueue.remove(item.id);
    } catch {
      locationQueue.markFailed(item.id);
    }
  }
}
