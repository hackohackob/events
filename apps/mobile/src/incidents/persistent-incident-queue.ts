import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@incident_queue_v1";

export interface PendingIncidentPayload {
  lat: number;
  lng: number;
  timestamp: string;
}

interface PersistentQueueItem {
  id: string;
  payload: PendingIncidentPayload;
  attempts: number;
  nextRetryAt: number;
  createdAt: number;
}

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

  async markFailed(id: string): Promise<void> {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return;
    item.attempts += 1;
    const delay = Math.min(30_000, 2 ** item.attempts * 1000);
    item.nextRetryAt = Date.now() + delay;
    await this.persist();
  }

  listReady(now = Date.now()): PersistentQueueItem[] {
    return this.items.filter((item) => item.nextRetryAt <= now);
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }
}

export const incidentQueue = new PersistentIncidentQueue();
