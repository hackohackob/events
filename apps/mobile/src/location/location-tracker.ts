import * as ExpoLocation from "expo-location";
import { apiFetch } from "../ui/api-client";
import { OfflineQueue } from "../offline/offline-queue";

const locationQueue = new OfflineQueue<Record<string, unknown>>();

export async function startLocationLoop(): Promise<void> {
  const permission = await ExpoLocation.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") {
    return;
  }

  setInterval(async () => {
    const location = await ExpoLocation.getCurrentPositionAsync({});
    const payload = {
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy: location.coords.accuracy ?? undefined,
      timestamp: new Date().toISOString(),
    };
    try {
      await apiFetch("/locations", { method: "POST", body: JSON.stringify(payload) });
    } catch {
      locationQueue.enqueue("location.update", payload);
    }
  }, 10_000);
}

export async function flushLocationQueue(): Promise<void> {
  const ready = locationQueue.listReady();
  for (const item of ready) {
    try {
      await apiFetch("/locations", { method: "POST", body: JSON.stringify(item.payload) });
      locationQueue.remove(item.id);
    } catch {
      locationQueue.markFailed(item.id);
    }
  }
}
