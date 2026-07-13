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

  /**
   * Enqueue `payload`, dropping any older queued items of the same `type`.
   * For last-write-wins data (location fixes) only the newest snapshot is
   * worth sending — replaying a long offline backlog as a burst both hammers
   * the radio when coverage returns and tells the server nothing new.
   */
  replaceLatest(type: string, payload: TPayload) {
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      if (this.queue[i].type === type) this.queue.splice(i, 1);
    }
    this.enqueue(type, payload);
  }

  get size(): number {
    return this.queue.length;
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
