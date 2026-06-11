import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { Roles } from "../common/decorators/roles.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { FieldGuideService, type FieldGuideCaseInput } from "./field-guide.service";

@Controller("field-guide")
@UseGuards(AuthGuard, RolesGuard)
export class FieldGuideController {
  constructor(private readonly fieldGuideService: FieldGuideService) {}

  @Get()
  list() {
    return this.fieldGuideService.list();
  }

  @Post()
  @Roles("coordinator")
  create(@Body() body: FieldGuideCaseInput) {
    return this.fieldGuideService.create(body);
  }

  @Put(":caseId")
  @Roles("coordinator")
  update(@Param("caseId") caseId: string, @Body() body: Partial<FieldGuideCaseInput>) {
    return this.fieldGuideService.update(caseId, body);
  }

  @Delete(":caseId")
  @Roles("coordinator")
  remove(@Param("caseId") caseId: string) {
    return this.fieldGuideService.remove(caseId);
  }
}
