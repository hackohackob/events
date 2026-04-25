type QueueItem<T> = {
  id: string;
  type: string;
  payload: T;
  attempts: number;
  nextRetryAt: number;
};

export class OfflineQueue<TPayload> {
  private readonly queue: QueueItem<TPayload>[] = [];

  enqueue(type: string, payload: TPayload) {
    this.queue.push({
      id: `q_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type,
      payload,
      attempts: 0,
      nextRetryAt: Date.now(),
    });
  }

  listReady(now = Date.now()): QueueItem<TPayload>[] {
    return this.queue.filter((item) => item.nextRetryAt <= now);
  }

  markFailed(id: string) {
    const item = this.queue.find((entry) => entry.id === id);
    if (!item) return;
    item.attempts += 1;
    const delay = Math.min(30_000, 2 ** item.attempts * 1000);
    item.nextRetryAt = Date.now() + delay;
  }

  remove(id: string) {
    const index = this.queue.findIndex((item) => item.id === id);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
  }
}
