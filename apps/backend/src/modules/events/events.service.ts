import { Injectable } from "@nestjs/common";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { ExampleDataService } from "../example-data/example-data.service";
import { CreateEventDto } from "./dto/create-event.dto";

export interface StoredDiscipline {
  name: string;
  type: string;
  distanceKm: number;
  ascentMeters: number;
  color: string;
  gpxFile?: string;
  gpxUrl?: string;
  trackId?: string;
}

export interface StoredDay {
  date: string;
  disciplines: StoredDiscipline[];
  pois: StoredPoi[];
  assignments: StoredAssignment[];
}

export interface StoredPoi {
  type: string;
  lng: number;
  lat: number;
  name?: string;
}

export interface StoredAssignment {
  userId: string;
  position?: string;
  vehicle?: string;
  description?: string;
}

export interface StoredLocation {
  name: string;
  lng: number;
  lat: number;
}

export interface EventRecord {
  id: string;
  title: string;
  description?: string;
  status: "draft" | "active" | "closed";
  imageUrl?: string;
  dates: string[];
  location?: StoredLocation;
  days: StoredDay[];
}

export interface EventSummary {
  id: string;
  title: string;
  status: "draft" | "active" | "closed";
  imageUrl?: string;
  dates: string[];
  location?: string;
  disciplineCount: number;
  medicCount: number;
  days: StoredDay[];
}

export interface EventTrack {
  id: string;
  label: string;
  points: Array<{ lat: number; lng: number }>;
  elevationProfile: {
    totalAscentMeters: number;
    totalDescentMeters: number;
    maxElevationMeters: number | null;
    minElevationMeters: number | null;
    segmentSlopes: number[];
    sections: Array<{
      type: "climb" | "descent";
      startIndex: number;
      endIndex: number;
      distanceMeters: number;
      elevationChangeMeters: number;
    }>;
  };
}

function toSummary(event: EventRecord): EventSummary {
  const disciplineCount = event.days.reduce((sum, d) => sum + d.disciplines.length, 0);
  const medicCount = event.days.reduce((sum, d) => sum + d.assignments.length, 0);
  return {
    id: event.id,
    title: event.title,
    status: event.status,
    imageUrl: event.imageUrl,
    dates: event.dates,
    location: event.location?.name,
    disciplineCount,
    medicCount,
    days: event.days,
  };
}

@Injectable()
export class EventsService {
  constructor(private readonly exampleDataService: ExampleDataService) {}

  private readonly events: EventRecord[] = [
    {
      id: "event-demo",
      title: "Pancharevo Race Day (10K / 21K / 42K)",
      status: "active",
      dates: [new Date().toISOString().split("T")[0]],
      days: [],
    },
  ];

  list(): EventSummary[] {
    return this.events.map(toSummary);
  }

  create(payload: CreateEventDto): EventSummary {
    const sortedDates = [...payload.dates].sort();
    const event: EventRecord = {
      id: `event-${Date.now().toString(36)}`,
      title: payload.title,
      description: payload.description,
      status: "draft",
      imageUrl: payload.imageUrl,
      dates: sortedDates,
      location: payload.location,
      days: payload.days.map((d) => ({
        date: d.date,
        disciplines: d.disciplines.map((disc) => ({
          name: disc.name,
          type: disc.type,
          distanceKm: disc.distanceKm,
          ascentMeters: disc.ascentMeters,
          color: disc.color,
          gpxFile: disc.gpxFile,
          gpxUrl: disc.gpxUrl,
          trackId: disc.trackId,
        })),
        pois: (d.pois || []).map((p) => ({ ...p })),
        assignments: (d.assignments || []).map((a) => ({ ...a })),
      })),
    };
    this.events.unshift(event);
    return toSummary(event);
  }

  findById(id: string): EventSummary | null {
    const event = this.events.find((e) => e.id === id);
    return event ? toSummary(event) : null;
  }

  activate(id: string): EventSummary | null {
    const event = this.events.find((e) => e.id === id);
    if (!event) return null;
    event.status = "active";
    return toSummary(event);
  }

  async storeGPX(file: { buffer: Buffer; originalname: string }): Promise<string> {
    const filename = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const dir = join(process.cwd(), "uploads", "gpx");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), file.buffer);
    return `/uploads/gpx/${filename}`;
  }

  listTracks(): EventTrack[] {
    return this.exampleDataService.listTracks().map((track) => ({
      id: track.id,
      label: track.label,
      points: track.points.map((point) => ({ lat: point.lat, lng: point.lng })),
      elevationProfile: {
        ...track.elevationProfile,
        segmentSlopes: [...track.elevationProfile.segmentSlopes],
        sections: track.elevationProfile.sections.map((section) => ({
          ...section,
        })),
      },
    }));
  }
}
