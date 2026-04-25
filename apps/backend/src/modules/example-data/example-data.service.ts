import { Injectable, Logger } from "@nestjs/common";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface TrackPoint {
  lat: number;
  lng: number;
}

interface RaceTrack {
  id: string;
  label: string;
  gpxFile: string;
  points: TrackPoint[];
}

interface ExampleRunnerRecord {
  eventId: string;
  userId: string;
  name: string;
  bibNumber: string;
  lastLat: number;
  lastLng: number;
  lastUpdate: string;
}

interface NamedParamedic {
  name: string;
  userId: string;
  vehicle: string;
  unitNumber: string;
  avatarUrl: string;
}

export interface ExampleMapMarker {
  eventId: string;
  userId: string;
  lat: number;
  lng: number;
  timestamp: string;
  type: "runner" | "paramedic";
  label: string;
  freshness: "fresh" | "warning" | "stale" | "offline";
  name?: string;
  bibNumber?: string;
  vehicle?: string;
  unitNumber?: string;
  avatarUrl?: string;
}

export interface ExampleIncident {
  id: string;
  eventId: string;
  lat: number;
  lng: number;
  type: string;
  description: string;
  status: "open";
  createdAt: string;
}

@Injectable()
export class ExampleDataService {
  private readonly logger = new Logger(ExampleDataService.name);
  private readonly tracks: RaceTrack[] = this.loadTracks();
  private readonly markerCache = new Map<string, ExampleMapMarker[]>();
  private readonly runnerCache = new Map<string, ExampleRunnerRecord[]>();
  private readonly incidentCache = new Map<string, ExampleIncident[]>();
  private readonly namedParamedics: NamedParamedic[] = [
    {
      name: "Ivan Petrov",
      userId: "paramedic-ivan-petrov",
      vehicle: "Ambulance Type B",
      unitNumber: "U-16",
      avatarUrl: "https://i.pravatar.cc/120?img=12",
    },
    {
      name: "Maria Georgieva",
      userId: "paramedic-maria-georgieva",
      vehicle: "Rapid Response SUV",
      unitNumber: "U-42",
      avatarUrl: "https://i.pravatar.cc/120?img=32",
    },
    {
      name: "Nikolay Dimitrov",
      userId: "paramedic-nikolay-dimitrov",
      vehicle: "Motor Medic",
      unitNumber: "M-04",
      avatarUrl: "https://i.pravatar.cc/120?img=51",
    },
    {
      name: "Elena Stoyanova",
      userId: "paramedic-elena-stoyanova",
      vehicle: "Ambulance Type C",
      unitNumber: "U-07",
      avatarUrl: "https://i.pravatar.cc/120?img=47",
    },
    {
      name: "Georgi Ivanov",
      userId: "paramedic-georgi-ivanov",
      vehicle: "Bike Medic",
      unitNumber: "B-11",
      avatarUrl: "https://i.pravatar.cc/120?img=61",
    },
    {
      name: "Raya Nikolova",
      userId: "paramedic-raya-nikolova",
      vehicle: "Rapid Response SUV",
      unitNumber: "U-21",
      avatarUrl: "https://i.pravatar.cc/120?img=25",
    },
    {
      name: "Daniel Hristov",
      userId: "paramedic-daniel-hristov",
      vehicle: "Ambulance Type B",
      unitNumber: "U-33",
      avatarUrl: "https://i.pravatar.cc/120?img=17",
    },
    {
      name: "Tanya Koleva",
      userId: "paramedic-tanya-koleva",
      vehicle: "Bike Medic",
      unitNumber: "B-05",
      avatarUrl: "https://i.pravatar.cc/120?img=15",
    },
    {
      name: "Peter Atanasov",
      userId: "paramedic-peter-atanasov",
      vehicle: "Ambulance Type C",
      unitNumber: "U-55",
      avatarUrl: "https://i.pravatar.cc/120?img=57",
    },
    {
      name: "Nina Todorova",
      userId: "paramedic-nina-todorova",
      vehicle: "Rapid Response SUV",
      unitNumber: "U-27",
      avatarUrl: "https://i.pravatar.cc/120?img=48",
    },
  ];

  listNamedParamedics(): NamedParamedic[] {
    return this.namedParamedics.map((item) => ({ ...item }));
  }

  listTracks(): RaceTrack[] {
    return this.tracks.map((track) => ({ ...track, points: [...track.points] }));
  }

  listMarkers(eventId: string): ExampleMapMarker[] {
    const existing = this.markerCache.get(eventId);
    if (existing) {
      return existing.map((marker) => ({ ...marker }));
    }

    const generated = [
      ...this.generateMarkers(eventId, "runner", 50),
      ...this.generateMarkers(eventId, "paramedic", 10),
    ];
    this.markerCache.set(eventId, generated);
    return generated.map((marker) => ({ ...marker }));
  }

  listRunners(eventId: string): ExampleRunnerRecord[] {
    const existing = this.runnerCache.get(eventId);
    if (existing) {
      return existing.map((runner) => ({ ...runner }));
    }

    const runners = this.generateMarkers(eventId, "runner", 50).map((marker, index) => ({
      eventId,
      userId: marker.userId,
      name: `Runner ${String(index + 1).padStart(2, "0")}`,
      bibNumber: String(1000 + index),
      lastLat: marker.lat,
      lastLng: marker.lng,
      lastUpdate: marker.timestamp,
    }));
    this.runnerCache.set(eventId, runners);
    return runners.map((runner) => ({ ...runner }));
  }

  listIncidents(eventId: string): ExampleIncident[] {
    const existing = this.incidentCache.get(eventId);
    if (existing) {
      return existing.map((incident) => ({ ...incident }));
    }

    if (this.tracks.length === 0) {
      return [];
    }

    const random = this.createRandom(`${eventId}:incidents`);
    const types = ["Medical", "Heat", "Fall", "Hydration"];
    const incidents = Array.from({ length: 8 }, (_, index) => {
      const track = this.tracks[index % this.tracks.length];
      const point = track.points[Math.floor(random() * track.points.length)];
      return {
        id: `incident-sample-${String(index + 1).padStart(3, "0")}`,
        eventId,
        lat: point.lat + (random() - 0.5) * 0.0003,
        lng: point.lng + (random() - 0.5) * 0.0003,
        type: types[index % types.length],
        description: `Sample ${types[index % types.length].toLowerCase()} incident`,
        status: "open" as const,
        createdAt: new Date(Date.now() - Math.floor(random() * 3_600_000)).toISOString(),
      };
    });

    this.incidentCache.set(eventId, incidents);
    return incidents.map((incident) => ({ ...incident }));
  }

  private loadTracks(): RaceTrack[] {
    const trackDescriptors = [
      { id: "track-10k", label: "10K", gpxFile: "Pancharevo-10K-2026_2 (1).gpx" },
      { id: "track-21k", label: "21K", gpxFile: "Pancharevo-21K_2025 (1).gpx" },
      { id: "track-42k", label: "42K", gpxFile: "Pancharevo-42K_2025 (1).gpx" },
    ];

    const loaded = trackDescriptors
      .map((descriptor) => {
        const filePath = this.resolveGpxPath(descriptor.gpxFile);
        if (!filePath) {
          this.logger.warn(`GPX file not found: ${descriptor.gpxFile}`);
          return null;
        }

        const xml = readFileSync(filePath, "utf8");
        const points = this.parseTrackPoints(xml);
        if (points.length === 0) {
          this.logger.warn(`No track points in GPX file: ${descriptor.gpxFile}`);
          return null;
        }

        return {
          id: descriptor.id,
          label: descriptor.label,
          gpxFile: descriptor.gpxFile,
          points,
        } satisfies RaceTrack;
      })
      .filter((track): track is RaceTrack => Boolean(track));

    return loaded;
  }

  private parseTrackPoints(xml: string): TrackPoint[] {
    const trkptRegex = /<trkpt\b([^>]*)>/g;
    const points: TrackPoint[] = [];
    let match = trkptRegex.exec(xml);

    while (match) {
      const attrs = match[1];
      const latMatch = attrs.match(/\blat="([^"]+)"/);
      const lonMatch = attrs.match(/\blon="([^"]+)"/);
      if (latMatch?.[1] && lonMatch?.[1]) {
        const lat = Number(latMatch[1]);
        const lng = Number(lonMatch[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          points.push({ lat, lng });
        }
      }
      match = trkptRegex.exec(xml);
    }

    return points;
  }

  private resolveGpxPath(fileName: string): string | null {
    const candidateRoots = [
      process.cwd(),
      path.resolve(process.cwd(), ".."),
      path.resolve(process.cwd(), "../.."),
      path.resolve(__dirname, "../../../../../"),
      path.resolve(__dirname, "../../../../../../"),
      path.resolve(__dirname, "../../../../../../../"),
    ];

    for (const root of candidateRoots) {
      const resolved = path.resolve(root, "example-data", fileName);
      if (existsSync(resolved)) {
        return resolved;
      }
    }

    return null;
  }

  private generateMarkers(
    eventId: string,
    type: "runner" | "paramedic",
    count: number,
  ): ExampleMapMarker[] {
    if (this.tracks.length === 0) {
      return [];
    }

    const random = this.createRandom(`${eventId}:${type}`);
    return Array.from({ length: count }, (_, index) => {
      const track = this.tracks[index % this.tracks.length];
      const basePoint = track.points[Math.floor(random() * track.points.length)];
      const jitterLat = (random() - 0.5) * 0.00045;
      const jitterLng = (random() - 0.5) * 0.00045;
      const updateAgeMs = Math.floor(random() * 150_000);
      const paramedic = this.namedParamedics[index % this.namedParamedics.length];

      return {
        eventId,
        userId: type === "runner" ? `${type}-sample-${String(index + 1).padStart(3, "0")}` : paramedic.userId,
        lat: basePoint.lat + jitterLat,
        lng: basePoint.lng + jitterLng,
        timestamp: new Date(Date.now() - updateAgeMs).toISOString(),
        type,
        label: type === "runner" ? `Runner ${String(index + 1).padStart(2, "0")}` : paramedic.name,
        freshness: this.freshnessFromAge(updateAgeMs),
        name: type === "runner" ? `Runner ${String(index + 1).padStart(2, "0")}` : paramedic.name,
        bibNumber: type === "runner" ? String(1000 + index) : undefined,
        vehicle: type === "paramedic" ? paramedic.vehicle : undefined,
        unitNumber: type === "paramedic" ? paramedic.unitNumber : undefined,
        avatarUrl: type === "paramedic" ? paramedic.avatarUrl : undefined,
      };
    });
  }

  private freshnessFromAge(ageMs: number): "fresh" | "warning" | "stale" | "offline" {
    if (ageMs < 30_000) return "fresh";
    if (ageMs < 120_000) return "warning";
    if (ageMs < 300_000) return "stale";
    return "offline";
  }

  private createRandom(seed: string): () => number {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    let state = hash >>> 0;
    return () => {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
