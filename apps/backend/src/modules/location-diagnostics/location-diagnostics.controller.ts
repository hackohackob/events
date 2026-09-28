import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { LocationDiagUpload, LocationTuning, isStaffRole } from "@events/contracts";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types/request-user.type";
import { LocationDiagnosticsService } from "./location-diagnostics.service";

/**
 * Location accuracy: the phone-side log of vague fixes and re-measures, and
 * the knobs that decide when the phone re-measures.
 */
@Controller()
@UseGuards(AuthGuard)
export class LocationDiagnosticsController {
  constructor(private readonly service: LocationDiagnosticsService) {}

  /** Medic app → server: a batch of sampled diagnostic lines. */
  @Post("events/:eventId/location-diagnostics")
  upload(@CurrentUser() user: RequestUser, @Param("eventId") eventId: string, @Body() body: LocationDiagUpload) {
    if (!isStaffRole(user.role)) throw new ForbiddenException("Only staff devices upload location diagnostics");
    return this.service.ingest(eventId, body);
  }

  @Get("events/:eventId/location-diagnostics")
  list(
    @Param("eventId") eventId: string,
    @Query("medicId") medicId?: string,
    @Query("kind") kind?: string,
    @Query("level") level?: string,
    @Query("before") before?: string,
    @Query("limit") limit?: string,
  ) {
    return this.service.list({ eventId, medicId, kind, level, before, limit: limit ? Number(limit) : undefined });
  }

  @Get("events/:eventId/location-diagnostics/summary")
  summary(@Param("eventId") eventId: string) {
    return this.service.summary(eventId);
  }

  /** Wake one medic's phone (or all of them) for a fresh high-accuracy fix. */
  @Post("events/:eventId/location-diagnostics/precise-fix")
  preciseFix(
    @CurrentUser() user: RequestUser,
    @Param("eventId") eventId: string,
    @Body() body: { medicId?: string },
  ) {
    if (user.role !== "coordinator") throw new ForbiddenException("Only coordinators can request fixes");
    return this.service.requestPreciseFix(eventId, body?.medicId || undefined);
  }

  @Get("location-tuning")
  getTuning(): LocationTuning {
    return this.service.getTuning();
  }

  @Put("location-tuning")
  updateTuning(@CurrentUser() user: RequestUser, @Body() body: Partial<LocationTuning>) {
    if (user.role !== "coordinator") throw new ForbiddenException("Only coordinators can change location tuning");
    return this.service.updateTuning(body ?? {});
  }
}
