import { Injectable } from "@nestjs/common";
import { ExampleDataService } from "../example-data/example-data.service";

export interface EventSummary {
  id: string;
  name: string;
  status: "draft" | "active" | "closed";
  startTime: string;
  endTime: string;
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
