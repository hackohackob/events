import { Controller, ForbiddenException, Get, Param, Query, UseGuards } from "@nestjs/common";
import { TRAIL_DEFAULT_HOURS, type TrailWindowMode } from "@events/contracts";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types/request-user.type";
import { TrailsService } from "./trails.service";

/**
 * Location history ("Trails").
 *
 * Visibility rule, enforced here and nowhere else:
 *   • any medic may read their OWN trail;
 *   • coordinators may read anyone's, and may pull several at once.
 * Runners get nothing — a trail is staff telemetry.
 */
@Controller("events/:eventId")
@UseGuards(AuthGuard)
export class TrailsController {
  constructor(private readonly trailsService: TrailsService) {}

  /** Medics with breadcrumbs in the window — the coordinator's replay picker. */
  @Get("trails")
  async listAvailable(
    @CurrentUser() user: RequestUser,
    @Param("eventId") eventId: string,
    @Query("hours") hours?: string,
    @Query("window") window?: string,
  ) {
    await this.assertCoordinator(eventId, user);
    return this.trailsService.listAvailable(eventId, { hours: parseHours(hours), mode: parseMode(window) });
  }

  /** Several trails in one call, for the team replay. Coordinators only. */
  @Get("trails/bundle")
  async getBundle(
    @CurrentUser() user: RequestUser,
    @Param("eventId") eventId: string,
    @Query("medicIds") medicIds?: string,
    @Query("hours") hours?: string,
    @Query("maxPoints") maxPoints?: string,
    @Query("window") window?: string,
  ) {
    await this.assertCoordinator(eventId, user);
    return this.trailsService.getBundle(eventId, (medicIds ?? "").split(",").filter(Boolean), {
      hours: parseHours(hours),
      maxPoints: parseNumber(maxPoints),
      mode: parseMode(window),
    });
  }

  /** My own trail — always allowed, no role check. */
  @Get("trails/me")
  getMine(
    @CurrentUser() user: RequestUser,
    @Param("eventId") eventId: string,
    @Query("hours") hours?: string,
    @Query("maxPoints") maxPoints?: string,
    @Query("window") window?: string,
  ) {
    return this.trailsService.getTrail(eventId, user.userId, {
      hours: parseHours(hours),
      maxPoints: parseNumber(maxPoints),
      mode: parseMode(window),
    });
  }

  @Get("trails/:medicId")
  async getOne(
    @CurrentUser() user: RequestUser,
    @Param("eventId") eventId: string,
    @Param("medicId") medicId: string,
    @Query("hours") hours?: string,
    @Query("maxPoints") maxPoints?: string,
    @Query("window") window?: string,
  ) {
    if (medicId !== user.userId) await this.assertCoordinator(eventId, user);
    return this.trailsService.getTrail(eventId, medicId, {
      hours: parseHours(hours),
      maxPoints: parseNumber(maxPoints),
      mode: parseMode(window),
    });
  }

  private async assertCoordinator(eventId: string, user: RequestUser): Promise<void> {
    if (!(await this.trailsService.isCoordinator(eventId, user.userId, user.role))) {
      throw new ForbiddenException("Only coordinators can view other medics' location history");
    }
  }
}

function parseHours(value?: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : TRAIL_DEFAULT_HOURS;
}

/** `?window=event` opts into the archive; anything else is the rolling view. */
function parseMode(value?: string): TrailWindowMode {
  return value === "event" ? "event" : "rolling";
}

function parseNumber(value?: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
