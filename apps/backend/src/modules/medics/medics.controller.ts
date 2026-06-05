import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types/request-user.type";
import { AddMedicDto } from "./dto/add-medic.dto";
import { AssignDestinationDto } from "./dto/assign-destination.dto";
import { BroadcastDto } from "./dto/broadcast.dto";
import { UpdateMedicStatusDto } from "./dto/update-medic-status.dto";
import { MedicsService } from "./medics.service";

@Controller("events/:eventId")
@UseGuards(AuthGuard)
export class MedicsController {
  constructor(private readonly medicsService: MedicsService) {}

  @Get("medics")
  getRoster(@Param("eventId") eventId: string) {
    return this.medicsService.getMedicRoster(eventId);
  }

  @Post("medics")
  addMedic(@Param("eventId") eventId: string, @Body() body: AddMedicDto) {
    return this.medicsService.addMedic(eventId, body);
  }

  @Get("medics/active")
  getActiveMedics(@Param("eventId") eventId: string) {
    return this.medicsService.getActiveMedics(eventId);
  }

  /**
   * HTTP fallback for background location updates when the WebSocket is not
   * available (e.g. app was killed and restarted by the OS task manager).
   */
  @Post("medics/:medicId/location")
  @HttpCode(HttpStatus.NO_CONTENT)
  async postMedicLocation(
    @Param("eventId") eventId: string,
    @Param("medicId") medicId: string,
    @Body() body: { lat: number; lng: number; accuracy?: number; speed?: number; heading?: number; battery?: number },
  ) {
    const medic = await this.medicsService.getMedicById(eventId, medicId);
    await this.medicsService.upsertMedicLocation({
      eventId,
      medicId,
      name: medic?.name ?? medicId,
      lat: body.lat,
      lng: body.lng,
      accuracy: body.accuracy,
      speed: body.speed,
      heading: body.heading,
      battery: body.battery,
    });
  }

  @Patch("medics/:medicId/assign")
  assignDestination(
    @CurrentUser() user: RequestUser,
    @Param("eventId") eventId: string,
    @Param("medicId") medicId: string,
    @Body() body: AssignDestinationDto,
  ) {
    return this.medicsService.assignDestination(
      eventId,
      medicId,
      body.destination,
      user.userId,
      user.role === "coordinator",
    );
  }

  @Patch("medics/:medicId/status")
  updateStatus(
    @Param("eventId") eventId: string,
    @Param("medicId") medicId: string,
    @Body() body: UpdateMedicStatusDto,
  ) {
    return this.medicsService.updateStatus(eventId, medicId, body.status);
  }

  @Post("broadcast")
  broadcast(@Param("eventId") eventId: string, @Body() body: BroadcastDto) {
    return this.medicsService.broadcast(eventId, body.title, body.body);
  }

  @Delete("medics/:medicId/active")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeActiveMedic(
    @Param("eventId") eventId: string,
    @Param("medicId") medicId: string,
  ) {
    return this.medicsService.removeActiveMedic(eventId, medicId);
  }

  @Get("participants")
  getParticipants(@Param("eventId") eventId: string) {
    return this.medicsService.getParticipants(eventId);
  }
}
