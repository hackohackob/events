import { randomUUID } from "crypto";
import { ConflictException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { DbService } from "../infra/db.service";
import { RedisService } from "../infra/redis.service";
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
  id: string;
  type: string;
  lng: number;
  lat: number;
  name?: string;
  description?: string;
  /** Custom glyph for custom points; overrides the default type icon on the map. */
  icon?: string;
  /** Archived POIs are hidden from the map for everyone. */
  archived?: boolean;
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
  color?: string;
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

const MOCK_MEDICS: Record<string, { name: string; unit?: string }> = {
  "1": { name: "Mike Johnson", unit: "Unit 1" },
  "2": { name: "Sarah Davis", unit: "Unit 2" },
  "3": { name: "Alex Thompson", unit: "Unit 1" },
  "4": { name: "Emma Wilson", unit: "Unit 3" },
  "5": { name: "Daniel Brown", unit: "Unit 2" },
  "8": { name: "Anna Schmidt", unit: "Unit 3" },
  "10": { name: "Sophie Laurent", unit: "Unit 1" },
  "11": { name: "Carlos Rivera", unit: "Unit 3" },
  "13": { name: "Tom Harris", unit: "Unit 1" },
  "14": { name: "Maria Gonzalez", unit: "Unit 2" },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseGpxPoints(content: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  const tagRe = /<trkpt\b([^>]+)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(content)) !== null) {
    const attrs = match[1];
    const latM = /lat="([^"]+)"/.exec(attrs);
    const lonM = /lon="([^"]+)"/.exec(attrs);
    if (!latM || !lonM) continue;
    const lat = parseFloat(latM[1]);
    const lng = parseFloat(lonM[1]);
    if (isFinite(lat) && isFinite(lng)) points.push({ lat, lng });
  }
  return points;
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

const DATA_FILE = join(process.cwd(), "data", "events.json");

const DEFAULT_EVENTS: EventRecord[] = [
  {
    id: "event-demo",
    title: "Pancharevo Race Day (10K / 21K / 42K)",
    status: "active",
    dates: [new Date().toISOString().split("T")[0]],
    days: [],
  },
];

@Injectable()
export class EventsService implements OnModuleInit {
  constructor(
    private readonly exampleDataService: ExampleDataService,
    private readonly db: DbService,
    private readonly redisService: RedisService,
  ) {}

  private events: EventRecord[] = [];

  async onModuleInit() {
    try {
      const raw = await readFile(DATA_FILE, "utf-8");
      this.events = JSON.parse(raw) as EventRecord[];
      // Backfill stable POI ids for events stored before ids existed.
      let mutated = false;
      for (const event of this.events) {
        for (const day of event.days) {
          for (const poi of day.pois ?? []) {
            if (!poi.id) {
              poi.id = randomUUID();
              mutated = true;
            }
          }
        }
      }
      if (mutated) await this.persist();
    } catch {
      this.events = [...DEFAULT_EVENTS];
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    await mkdir(join(process.cwd(), "data"), { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(this.events, null, 2), "utf-8");
  }

  list(): EventSummary[] {
    return this.events.map(toSummary);
  }

  async create(payload: CreateEventDto): Promise<EventSummary> {
    const sortedDates = [...payload.dates].sort();
    const event: EventRecord = {
      id: payload.id?.trim() || `event-${Date.now().toString(36)}`,
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
        pois: (d.pois || []).map((p) => ({ ...p, id: p.id?.trim() || randomUUID() })),
        assignments: (d.assignments || []).map((a) => ({ ...a })),
      })),
    };
    if (this.events.some((existing) => existing.id === event.id)) {
      throw new ConflictException(`Event ${event.id} already exists`);
    }
    this.events.unshift(event);
    await this.syncMedicRoster(event);
    await this.persist();
    return toSummary(event);
  }

  async update(id: string, payload: CreateEventDto): Promise<EventSummary | null> {
    const index = this.events.findIndex((e) => e.id === id);
    if (index === -1) return null;
    const existing = this.events[index]!;
    const sortedDates = [...payload.dates].sort();
    const updated: EventRecord = {
      ...existing,
      title: payload.title,
      description: payload.description,
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
        pois: (d.pois || []).map((p) => ({ ...p, id: p.id?.trim() || randomUUID() })),
        assignments: (d.assignments || []).map((a) => ({ ...a })),
      })),
    };
    this.events[index] = updated;
    await this.syncMedicRoster(updated);
    await this.persist();
    return toSummary(updated);
  }

  findById(id: string): EventSummary | null {
    const event = this.events.find((e) => e.id === id);
    return event ? toSummary(event) : null;
  }

  async remove(id: string): Promise<boolean> {
    const index = this.events.findIndex((e) => e.id === id);
    if (index === -1) return false;
    this.events.splice(index, 1);
    await this.persist();
    return true;
  }

  async activate(id: string): Promise<EventSummary | null> {
    const event = this.events.find((e) => e.id === id);
    if (!event) return null;
    event.status = "active";
    await this.persist();
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

  async listTracksForEvent(eventId: string): Promise<EventTrack[]> {
    const event = this.events.find((e) => e.id === eventId);
    if (!event) return [];

    const tracks: EventTrack[] = [];
    for (const day of event.days) {
      for (const disc of day.disciplines) {
        if (!disc.gpxUrl) continue;
        try {
          const filePath = join(process.cwd(), disc.gpxUrl);
          const content = await readFile(filePath, "utf-8");
          const points = parseGpxPoints(content);
          if (points.length < 2) continue;
          tracks.push({
            id: disc.trackId ?? disc.name.toLowerCase().replace(/\s+/g, "-"),
            label: disc.name,
            color: disc.color,
            points,
            elevationProfile: {
              totalAscentMeters: disc.ascentMeters ?? 0,
              totalDescentMeters: 0,
              maxElevationMeters: null,
              minElevationMeters: null,
              segmentSlopes: [],
              sections: [],
            },
          });
        } catch {
          // skip missing or unreadable GPX files
        }
      }
    }
    return tracks;
  }

  listPoisForEvent(eventId: string): StoredPoi[] {
    const event = this.events.find((e) => e.id === eventId);
    if (!event) return [];
    return event.days.flatMap((d) => d.pois).filter((p) => !p.archived);
  }

  /** Create a POI at the given coordinates (long-press on the map). */
  async createPoi(
    eventId: string,
    input: { lat: number; lng: number; type?: string; name?: string; description?: string },
  ): Promise<StoredPoi> {
    const event = this.events.find((e) => e.id === eventId);
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (event.days.length === 0) {
      event.days.push({ date: new Date().toISOString().slice(0, 10), disciplines: [], pois: [], assignments: [] });
    }
    const poi: StoredPoi = {
      id: randomUUID(),
      type: input.type?.trim() || "marker",
      lat: input.lat,
      lng: input.lng,
      name: input.name?.trim() || undefined,
      description: input.description?.trim() || undefined,
    };
    event.days[0].pois.push(poi);
    await this.persist();
    await this.redisService.publish(`event:${eventId}:map`, { type: "poi.created", payload: poi });
    return poi;
  }

  /** Archive a POI — hides it from the map for everyone. */
  async archivePoi(eventId: string, poiId: string): Promise<{ id: string }> {
    const event = this.events.find((e) => e.id === eventId);
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    for (const day of event.days) {
      const poi = day.pois.find((p) => p.id === poiId);
      if (poi) {
        poi.archived = true;
        await this.persist();
        await this.redisService.publish(`event:${eventId}:map`, {
          type: "poi.removed",
          payload: { id: poiId },
        });
        return { id: poiId };
      }
    }
    throw new NotFoundException(`POI ${poiId} not found`);
  }

  /** Edit a single POI (name/description) while the event is live. */
  async updatePoi(
    eventId: string,
    poiId: string,
    patch: { name?: string; description?: string },
  ): Promise<StoredPoi> {
    const event = this.events.find((e) => e.id === eventId);
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    for (const day of event.days) {
      const poi = day.pois.find((p) => p.id === poiId);
      if (poi) {
        if (patch.name !== undefined) poi.name = patch.name;
        if (patch.description !== undefined) poi.description = patch.description;
        await this.persist();
        return poi;
      }
    }
    throw new NotFoundException(`POI ${poiId} not found`);
  }

  private async syncMedicRoster(event: EventRecord): Promise<void> {
    const assignments = event.days.flatMap((day) => day.assignments);
    const uniqueUserIds = [...new Set(assignments.map((assignment) => assignment.userId))];
    if (uniqueUserIds.length === 0) return;

    const users = await this.db.query<{ id: string; name: string; unit: string | null; role: string | null }>(
      "SELECT id, name, unit, role FROM users",
    );
    const usersById = new Map(users.rows.map((user) => [user.id, user]));

    for (const userId of uniqueUserIds) {
      const assignment = assignments.find((item) => item.userId === userId);
      const user = usersById.get(userId);
      const fallback = MOCK_MEDICS[userId];
      const name = user?.name ?? fallback?.name;
      if (!name) continue;

      const unit = user?.unit ?? fallback?.unit ?? null;
      const vehicle = assignment?.vehicle ?? assignment?.position ?? null;
      // Carry the user's role onto the event roster so the mobile app knows who
      // can dispatch others. event_medics.type drives `amCoordinator` (and the
      // "Assign medic" button); without this it stays NULL and nobody is a
      // coordinator on the event. MedicType only has coordinator/paramedic/medic,
      // so any non-coordinator role collapses to "paramedic".
      const type = user?.role === "coordinator" ? "coordinator" : "paramedic";

      // Always let Postgres generate event_medics.id — never use the user UUID as the PK.
      // If the user UUID were reused as id, a user assigned to two different events would
      // hit a PK conflict on the second insert (ON CONFLICT covers event_id+name, not id).
      await this.db.query(
        `INSERT INTO event_medics (event_id, name, unit, vehicle, type)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (event_id, name) DO UPDATE SET unit = EXCLUDED.unit, vehicle = EXCLUDED.vehicle, type = EXCLUDED.type`,
        [event.id, name, unit, vehicle, type],
      );
    }
  }
}
