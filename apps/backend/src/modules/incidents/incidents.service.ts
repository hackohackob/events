import { Injectable, NotFoundException } from "@nestjs/common";
import { IncidentStatus, UserRole } from "@events/contracts";
import { RedisService } from "../infra/redis.service";
import { CreateIncidentDto } from "./dto/create-incident.dto";
import { IncidentActionDto } from "./dto/incident-action.dto";

interface IncidentRecord {
  id: string;
  eventId: string;
  lat: number;
  lng: number;
  type: string;
  description: string;
  severity?: string;
  photoUrl?: string;
  status: IncidentStatus;
  createdBy: string;
  createdAt: string;
  responders: string[];
}

@Injectable()
export class IncidentsService {
  private readonly incidents = new Map<string, IncidentRecord>();

  constructor(private readonly redisService: RedisService) {}

  async create(eventId: string, userId: string, input: CreateIncidentDto): Promise<IncidentRecord> {
    const id = `inc_${Date.now()}`;
    const incident: IncidentRecord = {
      id,
      eventId,
      lat: input.lat,
      lng: input.lng,
      type: input.type,
      description: input.description,
      severity: input.severity,
      photoUrl: input.photoUrl,
      status: "open",
      createdBy: userId,
      createdAt: new Date().toISOString(),
      responders: [],
    };
    this.incidents.set(id, incident);
    await this.redisService.publish(`event:${eventId}:incidents`, {
      type: "incident.created",
      payload: incident,
    });
    return incident;
  }

  list(eventId: string, role: UserRole): IncidentRecord[] {
    if (role === "runner" || role === "spectator") {
      return [];
    }
    return Array.from(this.incidents.values()).filter((item) => item.eventId === eventId);
  }

  async applyAction(eventId: string, incidentId: string, userId: string, action: IncidentActionDto) {
    const incident = this.incidents.get(incidentId);
    if (!incident || incident.eventId !== eventId) {
      throw new NotFoundException("Incident not found");
    }

    if (action.action === "going" && !incident.responders.includes(userId)) {
      incident.responders.push(userId);
      incident.status = "assigned";
    }
    if (action.action === "arrived") {
      incident.status = "in_progress";
    }
    if (action.action === "resolved") {
      incident.status = "resolved";
    }

    await this.redisService.publish(`event:${eventId}:ops`, {
      type: "incident.action",
      payload: { incidentId, userId, action: action.action, status: incident.status },
    });
    return incident;
  }

  async assign(eventId: string, incidentId: string, paramedicId: string) {
    const incident = this.incidents.get(incidentId);
    if (!incident || incident.eventId !== eventId) {
      throw new NotFoundException("Incident not found");
    }
    if (!incident.responders.includes(paramedicId)) {
      incident.responders.push(paramedicId);
    }
    incident.status = "assigned";
    await this.redisService.publish(`event:${eventId}:ops`, {
      type: "incident.assigned",
      payload: { incidentId, paramedicId, responders: incident.responders },
    });
    return incident;
  }
}
