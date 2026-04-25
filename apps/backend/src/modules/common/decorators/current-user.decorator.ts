import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { RequestUser } from "../types/request-user.type";

interface RequestWithUser {
  user?: RequestUser;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new Error("Current user context missing");
    }
    return request.user;
  },
);
