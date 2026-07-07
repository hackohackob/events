import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { UpsertHospitalDto } from "./dto/upsert-hospital.dto";
import { HospitalsService } from "./hospitals.service";

@Controller("hospitals")
@UseGuards(AuthGuard)
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  /** Directory listing — any authenticated role; clients sort by distance locally. */
  @Get()
  list(@Query("search") search?: string, @Query("capability") capability?: string) {
    return this.hospitalsService.list(search, capability);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles("coordinator")
  create(@Body() body: UpsertHospitalDto) {
    return this.hospitalsService.create(body);
  }

  @Put(":id")
  @UseGuards(RolesGuard)
  @Roles("coordinator")
  update(@Param("id") id: string, @Body() body: UpsertHospitalDto) {
    return this.hospitalsService.update(id, body);
  }

  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles("coordinator")
  remove(@Param("id") id: string) {
    return this.hospitalsService.remove(id);
  }
}
