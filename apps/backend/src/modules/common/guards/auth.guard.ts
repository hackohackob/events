import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { UserRole } from "@events/contracts";
import { RequestUser } from "../types/request-user.type";

interface RequestWithUser {
  headers: Record<string, string | undefined>;
  user?: RequestUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const userId = request.headers["x-user-id"] ?? "dev-user";
    const eventId = request.headers["x-event-id"] ?? "dev-event";
    const role = (request.headers["x-role"] as UserRole | undefined) ?? "coordinator";

    // Temporary dev mode: allow all requests even without auth headers.
    request.user = { userId, eventId, role };
    return true;
  }
}
