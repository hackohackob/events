import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { RequestUser } from "../common/types/request-user.type";
import { LocationUpdateDto } from "./dto/location-update.dto";
import { LocationsService } from "./locations.service";

@Controller("locations")
@UseGuards(AuthGuard)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: Omit<LocationUpdateDto, "eventId" | "userId">) {
    return this.locationsService.upsert({
      ...body,
      eventId: user.eventId,
      userId: user.userId,
    });
  }

  @Get("event")
  list(@CurrentUser() user: RequestUser) {
    return this.locationsService.listForEvent(user.eventId);
  }
}
