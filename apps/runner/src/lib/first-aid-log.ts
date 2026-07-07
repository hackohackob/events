import { sendIncidentMessage } from "../api";
import { enqueueMessage } from "./offline-queue";

/**
 * Fire-and-forget logger for guided-care actions (triage answers, CPR
 * start/stop). Entries are appended to the incident's chat so the response
 * team sees what first aid was performed, live.
 *
 * Sends are serialized (one POST at a time, small gap between them) so rapid
 * taps don't blast parallel requests; on a network failure the remaining
 * entries move to the IndexedDB message queue and go out with the next
 * background flush, preserving order. Everything is best-effort — guided care
 * must keep working with no incident and no connectivity.
 */

interface FirstAidEntry {
  incidentId: string;
  kind: "first_aid" | "cpr";
  text: string;
  meta?: Record<string, unknown>;
}

const SEND_GAP_MS = 250;

let activeIncidentId: string | null = null;
const queue: FirstAidEntry[] = [];
let flushing = false;

/** Set (or clear) the incident the guided-care session belongs to. */
export function setFirstAidIncident(id: string | null): void {
  activeIncidentId = id;
}

export function getFirstAidIncident(): string | null {
  return activeIncidentId;
}

/** Log a guided-care action. No-op when no incident is attached. */
export function logFirstAid(entry: Omit<FirstAidEntry, "incidentId">): void {
  if (!activeIncidentId) return;
  queue.push({ ...entry, incidentId: activeIncidentId });
  void flush();
}

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length > 0) {
      const entry = queue[0];
      try {
        await sendIncidentMessage(entry.incidentId, entry.text, {
          kind: entry.kind,
          meta: entry.meta,
        });
        queue.shift();
        if (queue.length > 0) await new Promise((r) => setTimeout(r, SEND_GAP_MS));
      } catch {
        // Network trouble — hand the rest to the persistent queue (flushed on
        // reconnect/boot by AppContext) and stop hammering.
        const rest = queue.splice(0);
        for (const e of rest) {
          await enqueueMessage({
            incidentId: e.incidentId,
            text: e.text,
            kind: e.kind,
            meta: e.meta,
          }).catch(() => undefined);
        }
        break;
      }
    }
  } finally {
    flushing = false;
  }
}
