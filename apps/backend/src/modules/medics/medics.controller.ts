import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/guards/auth.guard";
import { AddMedicDto } from "./dto/add-medic.dto";
import { AssignDestinationDto } from "./dto/assign-destination.dto";
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

  @Patch("medics/:medicId/assign")
  assignDestination(
    @Param("eventId") eventId: string,
    @Param("medicId") medicId: string,
    @Body() body: AssignDestinationDto,
  ) {
    return this.medicsService.assignDestination(eventId, medicId, body.destination);
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
