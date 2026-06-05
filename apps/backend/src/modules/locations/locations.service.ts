import { Injectable } from "@nestjs/common";
import { LocationUpdateDto } from "./dto/location-update.dto";
import { ExampleDataService } from "../example-data/example-data.service";
import { RedisService } from "../infra/redis.service";

export type FreshnessState = "fresh" | "warning" | "stale" | "offline";

export interface LiveLocation extends LocationUpdateDto {
  freshness: FreshnessState;
  type?: "runner" | "paramedic" | "incident";
  label?: string;
  name?: string;
  bibNumber?: string;
  vehicle?: string;
  avatarUrl?: string;
  description?: string;
  respondingIncidentId?: string;
  respondingParamedicIds?: string[];
}

@Injectable()
export class LocationsService {
  private readonly latest = new Map<string, LiveLocation>();

  constructor(
    private readonly redisService: RedisService,
    private readonly exampleDataService: ExampleDataService,
  ) {}

  async upsert(update: LocationUpdateDto): Promise<LiveLocation> {
    const freshness = this.computeFreshness(update.timestamp);
    const value: LiveLocation = { ...update, freshness, type: "runner" };
    const key = `${update.eventId}:${update.userId}`;
    this.latest.set(key, value);
    await this.redisService.setJson(`location:${key}`, value, 10 * 60);
    await this.redisService.publish(`event:${update.eventId}:map`, {
      type: "location.updated",
      payload: value,
    });
    return value;
  }

  listForEvent(eventId: string): LiveLocation[] {
    return Array.from(this.latest.values()).filter((item) => item.eventId === eventId);
  }

  private computeFreshness(isoTs: string): FreshnessState {
    const ageMs = Date.now() - new Date(isoTs).getTime();
    if (ageMs < 20 * 60_000) return "fresh"; // 0–20 min
    if (ageMs < 40 * 60_000) return "warning"; // 20–40 min
    return "stale"; // > 40 min
  }
}
