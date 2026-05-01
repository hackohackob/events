import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/guards/auth.guard";
import { UnitsService } from "./units.service";

@Controller("units")
@UseGuards(AuthGuard)
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Get()
  list() {
    return this.unitsService.list();
  }
}
