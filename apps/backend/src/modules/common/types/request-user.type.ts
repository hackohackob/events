import { UserRole } from "@events/contracts";

export interface RequestUser {
  userId: string;
  eventId: string;
  role: UserRole;
}
