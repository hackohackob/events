import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { RequestUser } from "../common/types/request-user.type";
import { CreateIncidentDto } from "./dto/create-incident.dto";
import { IncidentActionDto } from "./dto/incident-action.dto";
import { IncidentsService } from "./incidents.service";

@Controller("incidents")
@UseGuards(AuthGuard, RolesGuard)
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: CreateIncidentDto) {
    return this.incidentsService.create(user.eventId, user.userId, body);
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.incidentsService.list(user.eventId, user.role);
  }

  @Patch(":incidentId/action")
  @Roles("paramedic", "coordinator")
  action(
    @CurrentUser() user: RequestUser,
    @Param("incidentId") incidentId: string,
    @Body() body: IncidentActionDto,
  ) {
    return this.incidentsService.applyAction(user.eventId, incidentId, user.userId, body);
  }

  @Patch(":incidentId/assign/:paramedicId")
  @Roles("coordinator")
  assign(
    @CurrentUser() user: RequestUser,
    @Param("incidentId") incidentId: string,
    @Param("paramedicId") paramedicId: string,
  ) {
    return this.incidentsService.assign(user.eventId, incidentId, paramedicId);
  }
}
