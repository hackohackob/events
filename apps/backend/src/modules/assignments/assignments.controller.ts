import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { Roles } from "../common/decorators/roles.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AssignmentsService } from "./assignments.service";

@Controller("assignments")
@UseGuards(AuthGuard, RolesGuard)
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Post()
  @Roles("coordinator")
  assign(@Body() body: { incidentId: string; paramedicId: string }) {
    return this.assignmentsService.assign(body.incidentId, body.paramedicId);
  }

  @Get(":incidentId")
  @Roles("paramedic", "coordinator")
  list(@Param("incidentId") incidentId: string) {
    return this.assignmentsService.listByIncident(incidentId);
  }
}
