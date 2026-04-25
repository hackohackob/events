import { Injectable } from "@nestjs/common";
import { UserRole, VehicleType } from "@events/contracts";

export interface EventUser {
  eventId: string;
  userId: string;
  role: UserRole;
  bibNumber?: string;
  vehicleType?: VehicleType;
  trackingOptIn: boolean;
}

@Injectable()
export class EventUsersService {
  private readonly users = new Map<string, EventUser>();

  upsert(member: EventUser): EventUser {
    this.users.set(`${member.eventId}:${member.userId}`, member);
    return member;
  }

  get(eventId: string, userId: string): EventUser | null {
    return this.users.get(`${eventId}:${userId}`) ?? null;
  }
}
