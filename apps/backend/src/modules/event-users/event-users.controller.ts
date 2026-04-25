import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { RequestUser } from "../common/types/request-user.type";
import { EventUser, EventUsersService } from "./event-users.service";

@Controller("event-users")
@UseGuards(AuthGuard)
export class EventUsersController {
  constructor(private readonly eventUsersService: EventUsersService) {}

  @Post("self")
  upsertSelf(@CurrentUser() user: RequestUser, @Body() body: Partial<EventUser>) {
    return this.eventUsersService.upsert({
      eventId: user.eventId,
      userId: user.userId,
      role: user.role,
      trackingOptIn: body.trackingOptIn ?? true,
      bibNumber: body.bibNumber,
      vehicleType: body.vehicleType,
    });
  }
}
