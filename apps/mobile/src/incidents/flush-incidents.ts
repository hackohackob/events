import { createIncident } from "./incident-api";
import { incidentQueue } from "./persistent-incident-queue";
import { useIncidentStore } from "./incident-store";
import { debugLog } from "../debug/debug-log";

/**
 * Attempt to send every queued incident that is due for a retry. Successful
 * sends are removed; failures are backed off (and eventually marked permanently
 * failed so the badge stops flashing forever). Shared by App startup, the
 * connectivity listener, and the manual "Retry now" action.
 */
export async function flushIncidentQueue(): Promise<void> {
  const ready = incidentQueue.listReady();
  let flushed = 0;
  for (const item of ready) {
    try {
      await createIncident(item.payload);
      await incidentQueue.remove(item.id);
      flushed++;
    } catch (err) {
      await incidentQueue.markFailed(item.id, String(err));
      debugLog("incident", "error", "queued incident retry failed", String(err));
    }
  }
  if (flushed > 0) {
    debugLog("incident", "info", `${flushed} queued incident(s) sent`);
    useIncidentStore.getState().showToast(`${flushed} incident report${flushed > 1 ? "s" : ""} sent`);
  }
}
