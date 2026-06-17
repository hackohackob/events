import type { CreateIncidentRequest } from "../api/contracts-shim";
import { createIncident } from "../api";

const DB_NAME = "pe-runner";
const STORE = "incident-queue";

interface QueuedIncident {
  id: string;
  payload: CreateIncidentRequest;
  queuedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const store = db.transaction(STORE, mode).objectStore(STORE);
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
  await tx("readwrite", (s) => s.put(item));
}

export async function queuedCount(): Promise<number> {
  return tx<number>("readonly", (s) => s.count());
}

/** Best-effort: attempt to send every queued incident; remove on success. */
export async function flushQueue(): Promise<number> {
  const items = await tx<QueuedIncident[]>("readonly", (s) => s.getAll());
  let sent = 0;
  for (const item of items) {
    try {
      await createIncident(item.payload);
      await tx("readwrite", (s) => s.delete(item.id));
      sent++;
    } catch {
      break; // still offline / server unreachable — stop and retry later
    }
  }
  return sent;
}
