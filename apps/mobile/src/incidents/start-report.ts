import * as ExpoLocation from "expo-location";
import * as Haptics from "expo-haptics";
import { createIncident } from "./incident-api";
import { incidentQueue } from "./persistent-incident-queue";
import { useIncidentStore } from "./incident-store";
import { debugLog } from "../debug/debug-log";

/**
 * Begin an incident report: capture the current position, create the incident on
 * the server (or queue it offline), and drive the report sheet through its phases.
 * Shared by the on-screen FAB and the persistent-notification "Report incident"
 * action so both paths behave identically.
 *
 * Pass `at` to report a specific map point (e.g. a long-pressed location);
 * without it the reporter's current GPS position is used.
 */
export async function startIncidentReport(at?: { lat: number; lng: number }): Promise<void> {
  const store = useIncidentStore.getState();
  if (store.phase !== "idle") return; // a report is already in progress

  // Open the details sheet immediately; the incident is created on the server in
  // the background so the reporter never waits — they start filling in details
  // while it's already live and responders are being alerted.
  store.setCreationStatus("creating");
  store.setPhase("details");
  debugLog("incident", "info", "incident report started");

  try {
    let lat: number;
    let lng: number;
    if (at) {
      ({ lat, lng } = at);
    } else {
      const location = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.High });
      ({ latitude: lat, longitude: lng } = location.coords);
    }
    store.setLocation(lat, lng);

    const payload = { lat, lng, timestamp: new Date().toISOString() };

    try {
      const result = await createIncident(payload);
      store.setIncidentId(result.id);
      if (result.name) store.setIncidentName(result.name);
      store.setNearbyParamedics(result.nearbyParamedics ?? []);
      store.setCreationStatus("created");
      debugLog("incident", "info", "incident created", { id: result.id });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      await incidentQueue.enqueue(payload);
      store.setCreationStatus("failed");
      debugLog("incident", "error", "incident create failed — queued offline", String(err));
    }
  } catch (err) {
    store.setCreationStatus("failed");
    debugLog("incident", "error", "could not get location for incident", String(err));
  }
}
