import type { CreateIncidentRequest, IncidentMessageKind } from "../api/contracts-shim";
import { createIncident, sendIncidentMessage, uploadIncidentPhoto, uploadIncidentVoice } from "../api";

const DB_NAME = "pe-runner";
const STORE = "incident-queue";
const ATTACHMENT_STORE = "attachment-queue";
const MESSAGE_STORE = "message-queue";
const DB_VERSION = 3;

interface QueuedIncident {
  id: string;
  payload: CreateIncidentRequest;
  queuedAt: string;
}

/** A photo or voice note that failed to attach to an already-created incident.
 *  Kept keyed by incident id so it can be retried independently of the core
 *  incident payload (which goes out over the fast/small `incident-queue`). */
interface QueuedAttachment {
  id: string;
  incidentId: string;
  kind: "photo" | "voice";
  blob: Blob;
  fileName?: string;
  durationMs?: number;
  postToChat?: boolean;
  queuedAt: string;
}

/** An incident-chat message (e.g. a first-aid / CPR log entry from guided care)
 *  that failed to send. Order matters for the care timeline, so the flush
 *  replays them oldest-first and stops on the first failure. */
interface QueuedMessage {
  id: string;
  incidentId: string;
  text: string;
  kind?: IncidentMessageKind;
  meta?: Record<string, unknown>;
  queuedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!req.result.objectStoreNames.contains(ATTACHMENT_STORE)) {
        req.result.createObjectStore(ATTACHMENT_STORE, { keyPath: "id" });
      }
      if (!req.result.objectStoreNames.contains(MESSAGE_STORE)) {
        req.result.createObjectStore(MESSAGE_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const store = db.transaction(storeName, mode).objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueIncident(payload: CreateIncidentRequest): Promise<void> {
  const item: QueuedIncident = {
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    payload,
    queuedAt: new Date().toISOString(),
  };
  await tx(STORE, "readwrite", (s) => s.put(item));
}

export async function queuedCount(): Promise<number> {
  return tx<number>(STORE, "readonly", (s) => s.count());
}

/** Best-effort: attempt to send every queued incident; remove on success. */
export async function flushQueue(): Promise<number> {
  const items = await tx<QueuedIncident[]>(STORE, "readonly", (s) => s.getAll());
  let sent = 0;
  for (const item of items) {
    try {
      await createIncident(item.payload);
      await tx(STORE, "readwrite", (s) => s.delete(item.id));
      sent++;
    } catch {
      break; // still offline / server unreachable — stop and retry later
    }
  }
  return sent;
}

/** Queue a photo/voice attachment that failed to upload right after an
 *  incident was created (e.g. bad connection). Retried independently by
 *  `flushAttachmentQueue`, keyed by the already-created incident's id — the
 *  core incident report is never blocked or lost waiting on this. */
export async function enqueueAttachment(
  item: Omit<QueuedAttachment, "id" | "queuedAt">,
): Promise<void> {
  const record: QueuedAttachment = {
    ...item,
    id: `a_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    queuedAt: new Date().toISOString(),
  };
  await tx(ATTACHMENT_STORE, "readwrite", (s) => s.put(record));
}

export async function queuedAttachmentCount(): Promise<number> {
  return tx<number>(ATTACHMENT_STORE, "readonly", (s) => s.count());
}

export async function enqueueMessage(item: Omit<QueuedMessage, "id" | "queuedAt">): Promise<void> {
  const record: QueuedMessage = {
    ...item,
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    queuedAt: new Date().toISOString(),
  };
  await tx(MESSAGE_STORE, "readwrite", (s) => s.put(record));
}

/** Best-effort: replay queued incident-chat messages oldest-first; a failure
 *  stops the flush so the care timeline keeps its original order. */
export async function flushMessageQueue(): Promise<number> {
  const items = await tx<QueuedMessage[]>(MESSAGE_STORE, "readonly", (s) => s.getAll());
  items.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  let sent = 0;
  for (const item of items) {
    try {
      await sendIncidentMessage(item.incidentId, item.text, { kind: item.kind, meta: item.meta });
      await tx(MESSAGE_STORE, "readwrite", (s) => s.delete(item.id));
      sent++;
    } catch {
      break; // still offline / server unreachable — retry on the next flush
    }
  }
  return sent;
}

/** Best-effort: retry every queued photo/voice attachment; remove on success.
 *  Unlike `flushQueue`, one attachment's failure doesn't block the others —
 *  they target different incidents and independent uploads shouldn't wait on
 *  each other — but each individual failure still stops silently and waits
 *  for the next flush trigger (online event / app boot). */
export async function flushAttachmentQueue(): Promise<number> {
  const items = await tx<QueuedAttachment[]>(ATTACHMENT_STORE, "readonly", (s) => s.getAll());
  let sent = 0;
  for (const item of items) {
    try {
      if (item.kind === "photo") {
        await uploadIncidentPhoto(item.incidentId, item.blob, { postToChat: item.postToChat });
      } else {
        await uploadIncidentVoice(item.incidentId, item.blob, item.durationMs);
      }
      await tx(ATTACHMENT_STORE, "readwrite", (s) => s.delete(item.id));
      sent++;
    } catch {
      // still offline / server unreachable for this one — leave it queued and
      // keep trying the rest (they may target a reachable incident/host).
    }
  }
  return sent;
}
