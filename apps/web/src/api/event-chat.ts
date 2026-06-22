import client from "./client";
import type { EventMessage } from "@events/contracts";

function headers(eventId?: string) {
  return eventId ? { "x-event-id": eventId } : {};
}

export async function listEventMessages(eventId?: string): Promise<EventMessage[]> {
  const res = await client.get<EventMessage[]>("/event-chat/messages", { headers: headers(eventId) });
  return res.data;
}

export async function sendEventMessage(text: string, eventId?: string): Promise<EventMessage> {
  const res = await client.post<EventMessage>("/event-chat/messages", { text }, { headers: headers(eventId) });
  return res.data;
}
