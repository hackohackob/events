import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { RequestUser } from "../common/types/request-user.type";
import { RunnerSearchDto } from "./dto/runner-search.dto";
import { PlacesService } from "./places.service";
import { SearchService } from "./search.service";

@Controller("search")
@UseGuards(AuthGuard, RolesGuard)
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly placesService: PlacesService,
  ) {}

  @Get("runners")
  @Roles("paramedic", "coordinator")
  runnerSearch(@CurrentUser() user: RequestUser, @Query() query: RunnerSearchDto) {
    return this.searchService.search(user.eventId, query);
  }

  /** Online place autocomplete (towns, villages, rivers, localities, peaks…). */
  @Get("places")
  places(@Query("q") q?: string, @Query("lat") lat?: string, @Query("lng") lng?: string) {
    const query = (q ?? "").trim();
    if (query.length < 2) throw new BadRequestException("Query must be at least 2 characters.");
    const latNum = lat !== undefined ? Number(lat) : undefined;
    const lngNum = lng !== undefined ? Number(lng) : undefined;
    return this.placesService.searchOnline(
      query,
      Number.isFinite(latNum) ? latNum : undefined,
      Number.isFinite(lngNum) ? lngNum : undefined,
    );
  }

  /** Offline place pack: every named place within 10 km of the event's tracks. */
  @Get("event-places")
  eventPlaces(@CurrentUser() user: RequestUser) {
    return this.placesService.eventPlaces(user.eventId);
  }
}
