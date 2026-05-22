import client from "./client";
import type { EventFormData } from "@/lib/types";

export interface ApiEventSummary {
  id: string;
  title: string;
  status: "draft" | "active" | "closed";
  imageUrl?: string;
  dates: string[];
  location?: string;
  disciplineCount: number;
  medicCount: number;
  days?: Array<{
    date: string;
    disciplines: Array<{ name: string; type: string; distanceKm: number; ascentMeters: number; color: string; gpxUrl?: string }>;
    pois: Array<{ type: string; lng: number; lat: number; name?: string }>;
    assignments: Array<{ userId: string; position?: string; vehicle?: string; description?: string }>;
  }>;
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
  return res.data as ApiEventSummary[];
}

export async function createEvent(data: EventFormData) {
  const payload = {
    title: data.title,
    description: data.description || undefined,
    imageUrl: data.imageUrl || undefined,
    dates: data.dates.map((d) => d.toISOString().split("T")[0]),
    location: data.location
      ? {
          name: data.location.name,
          lng: data.location.coordinates[0],
          lat: data.location.coordinates[1],
        }
      : undefined,
    days: data.days.map((day) => ({
      date: day.date.toISOString().split("T")[0],
      disciplines: day.disciplines.map((disc) => ({
        name: disc.name,
        type: disc.type,
        distanceKm: disc.distance,
        ascentMeters: disc.elevation,
        color: disc.color,
        gpxFile: disc.gpxFile,
        gpxUrl: disc.gpxUrl,
      })),
      pois: day.pois.map((poi) => ({
        type: poi.type,
        lng: poi.coordinates[0],
        lat: poi.coordinates[1],
        name: poi.name,
      })),
      assignments: day.assignments.map((a) => ({
        userId: a.userId,
        position: a.position,
        vehicle: a.vehicle,
        description: a.description,
      })),
    })),
  };
  const res = await client.post("/events", payload);
  return res.data as ApiEventSummary;
}

export async function fetchTracks() {
  const res = await client.get("/events/tracks");
  return res.data as EventTrack[];
}

export async function fetchEventById(id: string): Promise<ApiEventSummary> {
  const res = await client.get(`/events/${id}`);
  return res.data as ApiEventSummary;
}

export async function activateEvent(id: string): Promise<ApiEventSummary> {
  const res = await client.patch(`/events/${id}/activate`);
  return res.data as ApiEventSummary;
}

export async function uploadGPX(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await client.post("/events/gpx", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return (res.data as { url: string }).url;
}
