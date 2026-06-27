import type { ParticipantLastLocation } from "@events/contracts";
import client from "./client";

/** Full participant roster (registered identity/track/medical + last location). */
export async function getParticipants(eventId: string): Promise<ParticipantLastLocation[]> {
  const { data } = await client.get<ParticipantLastLocation[]>(`/events/${eventId}/participants`);
  return data;
}
