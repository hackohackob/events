import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, UseGuards } from "@nestjs/common";
import {
  COVERAGE_DEFAULT_DAYS,
  COVERAGE_MAX_BATCH,
  CoverageSampleBatch,
  CoverageSampleBatchResult,
  coverageCellForZoom,
  isStaffRole,
} from "@events/contracts";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types/request-user.type";
import { CoverageBounds, CoverageQuery, CoverageService } from "./coverage.service";
import { SignalRecorderService } from "./signal-recorder.service";

/**
 * Signal coverage survey — the fleet-wide radio map.
 *
 * Coordinators only, and deliberately NOT scoped to one event: the whole value
 * of the survey is that it spans every event the team has ever worked. That
 * makes it staff-wide planning data, so the role check is the only gate and
 * there is no per-event variant of these routes.
 *
 * The coordinator role is global (it lives on the user, not on an event
 * roster), so the session role is the authority here.
 */
@Controller("coverage")
@UseGuards(AuthGuard)
export class CoverageController {
  constructor(
    private readonly coverageService: CoverageService,
    private readonly signalRecorder: SignalRecorderService,
  ) {}

  /** Aggregated grid for the current viewport. */
  @Get("grid")
  getGrid(
    @CurrentUser() user: RequestUser,
    @Query("bbox") bbox?: string,
    @Query("zoom") zoom?: string,
    @Query("cell") cell?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("days") days?: string,
    @Query("eventIds") eventIds?: string,
    @Query("carriers") carriers?: string,
    @Query("generations") generations?: string,
  ) {
    assertCoordinator(user);
    const query = parseQuery({ bbox, from, to, days, eventIds, carriers, generations });
    // An explicit `cell` wins; otherwise the zoom picks a sensible resolution,
    // and with neither we fall back to the mid ladder step.
    const explicitCell = Number(cell);
    const cellSize = Number.isFinite(explicitCell) && explicitCell > 0
      ? explicitCell
      : coverageCellForZoom(Number.isFinite(Number(zoom)) ? Number(zoom) : 9);
    return this.coverageService.getGrid({ ...query, cellSize });
  }

  /** Carriers / events / radio classes present, plus fleet-wide totals. */
  @Get("facets")
  getFacets(
    @CurrentUser() user: RequestUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("days") days?: string,
    @Query("eventIds") eventIds?: string,
    @Query("carriers") carriers?: string,
    @Query("generations") generations?: string,
  ) {
    assertCoordinator(user);
    // Facets deliberately ignore the viewport: they drive the filter controls,
    // which must keep offering a carrier even after you pan away from it.
    return this.coverageService.getFacets(parseQuery({ from, to, days, eventIds, carriers, generations }));
  }

  /**
   * A backlog of readings a device buffered while it had no way to report.
   *
   * Written by MEDICS, not coordinators — this is the one route here that is
   * not a coordinator read. Without it the survey is blind exactly where
   * coverage is worst, because a phone in a hole cannot post from the hole.
   *
   * The body is typed but not a DTO class on purpose: the global ValidationPipe
   * runs with `whitelist: true`, which would strip every nested field of a
   * class it cannot see decorators for. Validation is done explicitly below and
   * in the recorder, which clamps every column to its own range.
   */
  @Post("samples")
  ingestSamples(
    @CurrentUser() user: RequestUser,
    @Body() body: CoverageSampleBatch,
  ): CoverageSampleBatchResult {
    if (!isStaffRole(user.role)) {
      throw new ForbiddenException("Only staff devices report coverage samples");
    }
    const samples = Array.isArray(body?.samples) ? body.samples : null;
    if (!samples) throw new BadRequestException("samples must be an array");
    if (samples.length > COVERAGE_MAX_BATCH) {
      throw new BadRequestException(`at most ${COVERAGE_MAX_BATCH} samples per request`);
    }

    // The device carries the ids the readings were taken under: a medic may
    // have switched events between the outage and the flush, and the backlog
    // belongs to the event it was recorded on, not the current one.
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    const medicId = typeof body.medicId === "string" ? body.medicId.trim() : "";
    if (!eventId || !medicId) throw new BadRequestException("eventId and medicId are required");

    let accepted = 0;
    for (const sample of samples) {
      if (!sample || typeof sample !== "object" || !sample.signal) continue;
      const stored = this.signalRecorder.recordBackfill({
        eventId,
        medicId,
        lat: sample.lat,
        lng: sample.lng,
        recordedAt: sample.at,
        signal: sample.signal,
      });
      if (stored) accepted += 1;
    }
    return { accepted, rejected: samples.length - accepted };
  }

  /** Ranked black spots — the actionable end of the survey. */
  @Get("dead-zones")
  getDeadZones(
    @CurrentUser() user: RequestUser,
    @Query("bbox") bbox?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("days") days?: string,
    @Query("eventIds") eventIds?: string,
    @Query("carriers") carriers?: string,
    @Query("generations") generations?: string,
  ) {
    assertCoordinator(user);
    return this.coverageService.getDeadZones(
      parseQuery({ bbox, from, to, days, eventIds, carriers, generations }),
    );
  }
}

function assertCoordinator(user: RequestUser): void {
  if (user.role !== "coordinator") {
    throw new ForbiddenException("Only coordinators can view the signal coverage survey");
  }
}

interface RawQuery {
  bbox?: string;
  from?: string;
  to?: string;
  days?: string;
  eventIds?: string;
  carriers?: string;
  generations?: string;
}

function parseQuery(raw: RawQuery): CoverageQuery {
  const to = parseDate(raw.to) ?? new Date();
  const days = clamp(Number(raw.days), 1, 3650) ?? COVERAGE_DEFAULT_DAYS;
  const from = parseDate(raw.from) ?? new Date(to.getTime() - days * 86_400_000);

  return {
    // Guard against a reversed range producing an empty-but-valid query that
    // looks like "no coverage here" rather than a bad request.
    from: from <= to ? from : to,
    to,
    bounds: parseBounds(raw.bbox),
    eventIds: parseList(raw.eventIds),
    carriers: parseList(raw.carriers),
    generations: parseList(raw.generations),
  };
}

/** `west,south,east,north` — the order MapLibre's `getBounds().toArray()` gives. */
function parseBounds(bbox?: string): CoverageBounds | undefined {
  if (!bbox) return undefined;
  const parts = bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [west, south, east, north] = parts;
  return {
    south: Math.min(south, north),
    north: Math.max(south, north),
    // A viewport straddling the antimeridian arrives with west > east. Widening
    // to the full range is wrong but harmless (a few extra cells); silently
    // returning nothing would look like a bug in the map.
    west: Math.min(west, east),
    east: Math.max(west, east),
  };
}

function parseList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items.slice(0, 50) : undefined;
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function clamp(value: number, min: number, max: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}
