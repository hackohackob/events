import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/guards/auth.guard";
import { GuidanceDto } from "./dto/guidance.dto";
import { GuidanceService } from "./guidance.service";

@Controller("guidance")
@UseGuards(AuthGuard)
export class GuidanceController {
  constructor(private readonly guidanceService: GuidanceService) {}

  @Post()
  guide(@Body() body: GuidanceDto) {
    return this.guidanceService.guide(body.transcript, body.category);
  }
}
