import client from "./client";
import type {
  CreateDrawingRequest,
  EventDrawing,
  SnapLineResponse,
  SnapProfile,
  UpdateDrawingRequest,
} from "@events/contracts";

/** Team-only map drawings. All calls scope by x-event-id (see client interceptor). */

export async function listDrawings(eventId: string): Promise<EventDrawing[]> {
  const res = await client.get("/events/drawings", { headers: { "x-event-id": eventId } });
  return res.data;
}

export async function createDrawing(eventId: string, body: CreateDrawingRequest): Promise<EventDrawing> {
  const res = await client.post("/events/drawings", body, { headers: { "x-event-id": eventId } });
  return res.data;
}

export async function updateDrawing(
  eventId: string,
  drawingId: string,
  patch: UpdateDrawingRequest,
): Promise<EventDrawing> {
  const res = await client.patch(`/events/drawings/${drawingId}`, patch, {
    headers: { "x-event-id": eventId },
  });
  return res.data;
}

export async function deleteDrawing(eventId: string, drawingId: string): Promise<void> {
  await client.delete(`/events/drawings/${drawingId}`, { headers: { "x-event-id": eventId } });
}

/**
 * Pull a rough line onto the road/path network. Never rejects for "no road":
 * the backend answers with the line as sent and `snapped: false`. A network
 * failure is folded into the same shape so the caller has one path to handle.
 */
export async function snapLine(
  points: [number, number][],
  profile: SnapProfile,
  signal?: AbortSignal,
): Promise<SnapLineResponse> {
  try {
    const res = await client.post<SnapLineResponse>("/routing/snap-line", { points, profile }, { signal, timeout: 15_000 });
    return res.data;
  } catch {
    return { snapped: false, coordinates: points, distanceMeters: 0, reason: "engine_unavailable" };
  }
}
