import * as ExpoLocation from "expo-location";
import * as TaskManager from "expo-task-manager";
import { apiFetch } from "../ui/api-client";
import { getSocket } from "../realtime/socket-client";
import { useSessionStore } from "../security/session-store";
import { OfflineQueue } from "../offline/offline-queue";

export const LOCATION_TASK_NAME = "background-location-task";

const locationQueue = new OfflineQueue<Record<string, unknown>>();

// ─── Background task definition ──────────────────────────────────────────────
// Must be defined at module level (before registerRootComponent) so the native
// side can wake the JS runtime and find the task handler.

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: any) => {
  if (error) {
    console.warn("[LocationTask] error:", error.message);
    return;
  }

  const locations: ExpoLocation.LocationObject[] = data?.locations ?? [];
  if (!locations.length) return;

  const location = locations[locations.length - 1]!;
  const session = useSessionStore.getState();

  if (session.role === "medic" || session.role === "paramedic") {
    // Try WebSocket first (connected when app is backgrounded but alive).
    // Falls back to HTTP POST so updates survive app kills.
    const payload = {
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy: location.coords.accuracy ?? undefined,
      speed: location.coords.speed ?? undefined,
      heading: location.coords.heading ?? undefined,
    };

    const socket = getSocket();
    if (socket.connected) {
      socket.emit("medic_location", payload);
    } else {
      const eventId = session.eventId ?? "";
      const medicId = session.userId ?? "";
      try {
        await apiFetch(`/events/${eventId}/medics/${medicId}/location`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } catch {
        locationQueue.enqueue("medic_location", { ...payload, eventId, medicId });
      }
    }
  } else {
    // Participant / runner
    const eventId = session.eventId ?? "";
    const payload = {
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy: location.coords.accuracy ?? undefined,
      timestamp: new Date(location.timestamp).toISOString(),
    };
    try {
      await apiFetch(`/events/${eventId}/location`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch {
      locationQueue.enqueue("location.update", payload);
    }
  }
});

// ─── Public API ──────────────────────────────────────────────────────────────

export async function startLocationLoop(): Promise<void> {
  const session = useSessionStore.getState();
  const isMedic = session.role === "medic" || session.role === "paramedic";

  // 1. Foreground permission (required before asking for background)
  const { status: fgStatus } = await ExpoLocation.requestForegroundPermissionsAsync();
  if (fgStatus !== "granted") {
    console.warn("[LocationTracker] foreground location permission denied");
    return;
  }

  // 2. Background permission (Android shows a system dialog)
  const { status: bgStatus } = await ExpoLocation.requestBackgroundPermissionsAsync();
  if (bgStatus !== "granted") {
    console.warn("[LocationTracker] background location permission denied — updates will stop when app is backgrounded");
  }

  // 3. Stop any previously running task before (re)starting
  const running = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (running) {
    await ExpoLocation.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }

  // 4. Start continuous background updates
  await ExpoLocation.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: isMedic ? ExpoLocation.Accuracy.Balanced : ExpoLocation.Accuracy.Low,
    timeInterval: isMedic ? 20_000 : 60_000,   // ms between updates
    distanceInterval: isMedic ? 15 : 50,        // min metres between updates
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
}

export async function stopLocationLoop(): Promise<void> {
  const running = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (running) {
    await ExpoLocation.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
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
