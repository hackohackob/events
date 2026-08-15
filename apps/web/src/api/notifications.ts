import client from "./client";

export interface PushSubscription {
  id: string;
  userId: string;
  /** Roster name this device last joined under, when it could be resolved. */
  userName: string | null;
  eventId: string;
  platform: string;
  deviceId: string | null;
  tokenPreview: string;
  updatedAt: string;
}

export async function fetchPushSubscriptions(eventId?: string): Promise<PushSubscription[]> {
  const res = await client.get("/notifications/subscriptions", {
    params: eventId ? { eventId } : undefined,
  });
  return res.data as PushSubscription[];
}

export async function deletePushSubscription(id: string): Promise<void> {
  await client.delete(`/notifications/subscriptions/${id}`);
}

/** Clears every device, or every device on one event. */
export async function clearPushSubscriptions(eventId?: string): Promise<{ deleted: number }> {
  const res = await client.delete("/notifications/subscriptions", {
    params: eventId ? { eventId } : undefined,
  });
  return res.data as { deleted: number };
}
