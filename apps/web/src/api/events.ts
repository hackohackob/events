import client from "./client";

export interface EventDisciplinePayload {
  date: string;
  title: string;
  distanceKm: number;
  ascentMeters: number;
  color: string;
  gpxFile: string;
  trackId?: string;
}

export interface CreateEventPayload {
  title: string;
  imageUrl?: string;
  dates: string[];
  disciplines: EventDisciplinePayload[];
}

export interface EventSummary {
  id: string;
  name: string;
  status: "draft" | "active" | "closed";
  startTime: string;
  endTime: string;
  imageUrl?: string;
  dates?: string[];
  disciplines?: EventDisciplinePayload[];
}

export interface EventTrack {
  id: string;
  label: string;
  color?: string;
  points: Array<{ lat: number; lng: number }>;
  elevationProfile?: {
    totalAscentMeters: number;
    totalDescentMeters: number;
    maxElevationMeters: number | null;
    minElevationMeters: number | null;
  };
}

export async function fetchEvents() {
  const res = await client.get("/events");
  return res.data as EventSummary[];
}

export async function createEvent(payload: CreateEventPayload) {
  const res = await client.post("/events", payload);
  return res.data as EventSummary;
}

export async function fetchTracks() {
  const res = await client.get("/events/tracks");
  return res.data as EventTrack[];
}
