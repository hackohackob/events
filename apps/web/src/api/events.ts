import client from "./client";
import type { EventFormData } from "@/lib/types";

export interface ApiEventSummary {
  id: string;
  title: string;
  status: "draft" | "active" | "closed";
  imageUrl?: string;
  commandPhone?: string;
  dates: string[];
  location?: string;
  disciplineCount: number;
  medicCount: number;
  days?: Array<{
    date: string;
    disciplines: Array<{ name: string; type: string; distanceKm: number; ascentMeters: number; color: string; gpxUrl?: string }>;
    pois: Array<{ id?: string; type: string; lng: number; lat: number; name?: string; description?: string; icon?: string }>;
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
    id: data.eventKey.trim() || undefined,
    title: data.title,
    description: data.description || undefined,
    imageUrl: data.imageUrl || undefined,
    commandPhone: data.commandPhone.trim() || undefined,
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
        description: poi.description,
        icon: poi.icon,
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

export async function updateEvent(id: string, data: EventFormData) {
  const payload = {
    id,
    title: data.title,
    description: data.description || undefined,
    imageUrl: data.imageUrl || undefined,
    commandPhone: data.commandPhone.trim() || undefined,
    dates: data.dates.map((d) => d.toISOString().split("T")[0]),
    location: data.location
      ? { name: data.location.name, lng: data.location.coordinates[0], lat: data.location.coordinates[1] }
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
      pois: day.pois.map((poi) => ({ id: poi.id, type: poi.type, lng: poi.coordinates[0], lat: poi.coordinates[1], name: poi.name, description: poi.description, icon: poi.icon })),
      assignments: day.assignments.map((a) => ({ userId: a.userId, position: a.position, vehicle: a.vehicle, description: a.description })),
    })),
  };
  const res = await client.put(`/events/${id}`, payload);
  return res.data as ApiEventSummary;
}

export async function updatePoi(
  eventId: string,
  poiId: string,
  patch: { name?: string; description?: string },
): Promise<{ id: string; type: string; lat: number; lng: number; name?: string; description?: string }> {
  const res = await client.patch(`/events/${eventId}/pois/${poiId}`, patch);
  return res.data;
}

export async function deleteEvent(id: string): Promise<void> {
  await client.delete(`/events/${id}`);
}

export async function duplicateEvent(id: string): Promise<ApiEventSummary> {
  const source = await fetchEventById(id);
  const payload = {
    title: `Copy of ${source.title}`,
    commandPhone: source.commandPhone,
    dates: source.dates,
    days: (source.days ?? []).map((day) => ({
      date: day.date,
      disciplines: day.disciplines.map((disc) => ({ ...disc, gpxFile: undefined })),
      pois: day.pois,
      assignments: day.assignments,
    })),
  };
  const res = await client.post("/events", payload);
  return res.data as ApiEventSummary;
}

export async function activateEvent(id: string): Promise<ApiEventSummary> {
  const res = await client.patch(`/events/${id}/activate`);
  return res.data as ApiEventSummary;
}

export async function deactivateEvent(id: string): Promise<ApiEventSummary> {
  const res = await client.patch(`/events/${id}/deactivate`);
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
