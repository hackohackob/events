import * as ExpoLocation from "expo-location";
import { apiFetch } from "../ui/api-client";
import { getSocket } from "../realtime/socket-client";
import { useSessionStore } from "../security/session-store";
import { OfflineQueue } from "../offline/offline-queue";

const locationQueue = new OfflineQueue<Record<string, unknown>>();

/** Medics stream location every 20-30s via WebSocket */
async function startMedicLocationLoop(): Promise<void> {
  const permission = await ExpoLocation.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") return;

  setInterval(async () => {
    try {
      const location = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      const socket = getSocket();
      socket.emit("medic_location", {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        accuracy: location.coords.accuracy ?? undefined,
        speed: location.coords.speed ?? undefined,
        heading: location.coords.heading ?? undefined,
      });
    } catch {
      // ignore — WS reconnects automatically
    }
  }, 25_000); // every 25s
}

/** Participants send location every 60s via HTTP POST */
async function startParticipantLocationLoop(eventId: string): Promise<void> {
  const permission = await ExpoLocation.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") return;

  setInterval(async () => {
    try {
      const location = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Low,
      });
      const payload = {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        accuracy: location.coords.accuracy ?? undefined,
        timestamp: new Date().toISOString(),
      };
      try {
        await apiFetch(`/events/${eventId}/location`, { method: "POST", body: JSON.stringify(payload) });
      } catch {
        locationQueue.enqueue("location.update", payload);
      }
    } catch {
      // location unavailable
    }
  }, 60_000); // every 60s
}

export async function startLocationLoop(): Promise<void> {
  const session = useSessionStore.getState();
  if (session.role === "medic" || session.role === "paramedic") {
    await startMedicLocationLoop();
  } else {
    await startParticipantLocationLoop(session.eventId ?? "");
  }
}

export async function flushLocationQueue(): Promise<void> {
  const session = useSessionStore.getState();
  const eventId = session.eventId ?? "";
  const ready = locationQueue.listReady();
  for (const item of ready) {
    try {
      await apiFetch(`/events/${eventId}/location`, { method: "POST", body: JSON.stringify(item.payload) });
      locationQueue.remove(item.id);
    } catch {
      locationQueue.markFailed(item.id);
    }
  }
}
