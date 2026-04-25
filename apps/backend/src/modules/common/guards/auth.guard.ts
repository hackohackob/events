import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
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
    const userId = request.headers["x-user-id"];
    const eventId = request.headers["x-event-id"];
    const role = request.headers["x-role"] as UserRole | undefined;

    if (!userId || !eventId || !role) {
      throw new UnauthorizedException("Missing auth headers");
    }

    request.user = { userId, eventId, role };
    return true;
  }
}
