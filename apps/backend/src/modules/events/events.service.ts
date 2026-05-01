import { Injectable } from "@nestjs/common";
import { ExampleDataService } from "../example-data/example-data.service";
import { CreateEventDto } from "./dto/create-event.dto";

export interface EventSummary {
  id: string;
  name: string;
  status: "draft" | "active" | "closed";
  startTime: string;
  endTime: string;
  imageUrl?: string;
  dates?: string[];
  disciplines?: Array<{
    date: string;
    title: string;
    distanceKm: number;
    ascentMeters: number;
    color: string;
    gpxFile: string;
    trackId?: string;
  }>;
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

@Injectable()
export class EventsService {
  constructor(private readonly exampleDataService: ExampleDataService) {}

  private readonly events: EventSummary[] = [
    {
      id: "event-demo",
      name: "Pancharevo Race Day (10K / 21K / 42K)",
      status: "active",
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    },
  ];

  list(): EventSummary[] {
    return this.events;
  }

  create(payload: CreateEventDto): EventSummary {
    const sortedDates = [...payload.dates].sort();
    const event: EventSummary = {
      id: `event-${Date.now().toString(36)}`,
      name: payload.title,
      status: "draft",
      startTime: new Date(`${sortedDates[0]}T00:00:00.000Z`).toISOString(),
      endTime: new Date(`${sortedDates[sortedDates.length - 1]}T23:59:59.000Z`).toISOString(),
      imageUrl: payload.imageUrl,
      dates: sortedDates,
      disciplines: payload.disciplines.map((discipline) => ({ ...discipline })),
    };
    this.events.unshift(event);
    return event;
  }

  listTracks(): EventTrack[] {
    return this.exampleDataService.listTracks().map((track) => ({
      id: track.id,
      label: track.label,
      points: track.points.map((point) => ({ lat: point.lat, lng: point.lng })),
      elevationProfile: {
        ...track.elevationProfile,
        segmentSlopes: [...track.elevationProfile.segmentSlopes],
        sections: track.elevationProfile.sections.map((section) => ({ ...section })),
      },
    }));
  }
}
