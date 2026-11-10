import type { EventDrawing } from "@events/contracts";
import { apiFetch } from "../../ui/api-client";

/**
 * Team drawings are made on the dashboard only — the app reads them and never
 * writes. The backend rejects runner/spectator sessions.
 */
export async function fetchDrawings(): Promise<EventDrawing[]> {
  return apiFetch<EventDrawing[]>("/events/drawings");
}
