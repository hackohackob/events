import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@events/contracts";
import { ROLES_KEY } from "../decorators/roles.decorator";

interface RequestWithUser {
  user?: { role: UserRole };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Keep reading metadata so imports/symbol usage remain intact while auth is disabled.
    this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    context.switchToHttp().getRequest<RequestWithUser>();

    // Temporary dev mode: bypass role checks.
    return true;
  }
}
