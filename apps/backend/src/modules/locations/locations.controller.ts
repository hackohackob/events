import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { MedicsService } from "../medics/medics.service";
import { RequestUser } from "../common/types/request-user.type";
import { LocationUpdateDto } from "./dto/location-update.dto";
import { LocationsService } from "./locations.service";
import { ParticipantLocationDto } from "./dto/participant-location.dto";

@Controller()
@UseGuards(AuthGuard)
export class LocationsController {
  constructor(
    private readonly locationsService: LocationsService,
    private readonly medicsService: MedicsService,
  ) {}

  /** Legacy: in-memory location store (example data + live runners via WS) */
  @Post("locations")
  create(@CurrentUser() user: RequestUser, @Body() body: Omit<LocationUpdateDto, "eventId" | "userId">) {
    return this.locationsService.upsert({
      ...body,
      eventId: user.eventId,
      userId: user.userId,
    });
  }

  @Get("locations/event")
  list(@CurrentUser() user: RequestUser) {
    return this.locationsService.listForEvent(user.eventId);
  }

  /** Participant passive location — HTTP POST every 60s from mobile background */
  @Post("events/:eventId/location")
  async reportParticipantLocation(
    @Param("eventId") eventId: string,
    @CurrentUser() user: RequestUser,
    @Body() body: ParticipantLocationDto,
  ) {
    await this.medicsService.upsertParticipantLocation({
      userId: user.userId,
      eventId,
      name: user.userId, // name is stored in the token; extracted via session in real JWT
      lat: body.lat,
      lng: body.lng,
      accuracy: body.accuracy,
      timestamp: body.timestamp,
    });
    return { ok: true };
  }
}
