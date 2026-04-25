import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { RequestUser } from "../common/types/request-user.type";
import { RunnerSearchDto } from "./dto/runner-search.dto";
import { SearchService } from "./search.service";

@Controller("search")
@UseGuards(AuthGuard, RolesGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get("runners")
  @Roles("paramedic", "coordinator")
  runnerSearch(@CurrentUser() user: RequestUser, @Query() query: RunnerSearchDto) {
    return this.searchService.search(user.eventId, query);
  }
}
