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
    const live = Array.from(this.latest.values()).filter((item) => item.eventId === eventId);
    const incidentItems = this.exampleDataService.listIncidents(eventId);
    const primaryIncident = incidentItems[0];
    const responders = this.exampleDataService.listNamedParamedics().slice(0, 3);

    const seededMarkers = this.exampleDataService.listMarkers(eventId).map((marker, index) => {
      const responderIndex = responders.findIndex((responder) => responder.userId === marker.userId);
      const isResponder = marker.type === "paramedic" && responderIndex >= 0 && primaryIncident;
      const offsetLat = isResponder ? (responderIndex - 1) * 0.00035 : 0;
      const offsetLng = isResponder ? (responderIndex - 1) * 0.00025 : 0;
      return {
        eventId: marker.eventId,
        userId: marker.userId,
        lat: isResponder ? primaryIncident.lat + offsetLat : marker.lat,
        lng: isResponder ? primaryIncident.lng + offsetLng : marker.lng,
        timestamp: marker.timestamp,
        freshness: marker.freshness,
        type: marker.type,
        label: marker.label,
        name: marker.name,
        bibNumber: marker.type === "paramedic" ? marker.unitNumber : marker.bibNumber,
        vehicle: marker.vehicle,
        avatarUrl: marker.avatarUrl,
        respondingIncidentId: isResponder ? primaryIncident.id : undefined,
      };
    });
    const seededIncidents = incidentItems.map((incident) => ({
      eventId: incident.eventId,
      userId: incident.id,
      lat: incident.lat,
      lng: incident.lng,
      timestamp: incident.createdAt,
      freshness: "warning" as const,
      type: "incident" as const,
      label: incident.type,
      description: incident.description,
      respondingParamedicIds:
        primaryIncident && incident.id === primaryIncident.id ? responders.map((responder) => responder.userId) : [],
    }));
    const liveIds = new Set(live.map((item) => item.userId));
    const seeded = [...seededMarkers, ...seededIncidents];
    return [...live, ...seeded.filter((item) => !liveIds.has(item.userId))];
  }

  private computeFreshness(isoTs: string): FreshnessState {
    const ageMs = Date.now() - new Date(isoTs).getTime();
    if (ageMs < 30_000) return "fresh";
    if (ageMs < 120_000) return "warning";
    if (ageMs < 300_000) return "stale";
    return "offline";
  }
}
