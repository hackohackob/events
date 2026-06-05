import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@incident_queue_v1";

export interface PendingIncidentPayload {
  lat: number;
  lng: number;
  timestamp: string;
}

export interface PersistentQueueItem {
  id: string;
  payload: PendingIncidentPayload;
  attempts: number;
  nextRetryAt: number;
  createdAt: number;
  /** Set once attempts exceed MAX_ATTEMPTS — stops the infinite retry/flash. */
  failedPermanently?: boolean;
  lastError?: string;
}

const MAX_ATTEMPTS = 6;

class PersistentIncidentQueue {
  private items: PersistentQueueItem[] = [];
  private hydrated = false;

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.items = JSON.parse(raw) as PersistentQueueItem[];
      }
    } catch {
      this.items = [];
    }
    this.hydrated = true;
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch {
      // best-effort
    }
  }

  async enqueue(payload: PendingIncidentPayload): Promise<string> {
    const id = `iq_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    this.items.push({ id, payload, attempts: 0, nextRetryAt: Date.now(), createdAt: Date.now() });
    await this.persist();
    return id;
  }

  async remove(id: string): Promise<void> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index >= 0) {
      this.items.splice(index, 1);
      await this.persist();
    }
  }

  async markFailed(id: string, error?: string): Promise<void> {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return;
    item.attempts += 1;
    item.lastError = error;
    if (item.attempts >= MAX_ATTEMPTS) {
      item.failedPermanently = true;
    }
    const delay = Math.min(30_000, 2 ** item.attempts * 1000);
    item.nextRetryAt = Date.now() + delay;
    await this.persist();
  }

  /** Reset a permanently-failed item so the user can retry it manually. */
  async retry(id: string): Promise<void> {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return;
    item.failedPermanently = false;
    item.attempts = 0;
    item.nextRetryAt = Date.now();
    await this.persist();
  }

  /** Items eligible for an automatic send attempt right now. */
  listReady(now = Date.now()): PersistentQueueItem[] {
    return this.items.filter((item) => !item.failedPermanently && item.nextRetryAt <= now);
  }

  /** All pending items (including permanently failed) for UI display. */
  list(): PersistentQueueItem[] {
    return [...this.items];
  }

  get count(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }
}

export const incidentQueue = new PersistentIncidentQueue();
