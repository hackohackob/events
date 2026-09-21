import { BadRequestException, Body, Controller, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types/request-user.type";
import { DEFAULT_VEHICLE_TYPE, VEHICLE_TYPES, type VehicleType } from "@events/contracts";
import { RouteRequestDto } from "./dto/route-request.dto";
import { ClosestMedicsService } from "./closest-medics.service";
import { ExitPointsService } from "./exit-points.service";
import { RoutingService } from "./routing.service";
import { TrackAccessService } from "./track-access.service";
import type { LngLat, RouteResponse } from "./routing.types";

@Controller("routing")
@UseGuards(AuthGuard)
export class RoutingController {
  constructor(
    private readonly routingService: RoutingService,
    private readonly exitPoints: ExitPointsService,
    private readonly closestMedicsService: ClosestMedicsService,
    private readonly trackAccess: TrackAccessService,
  ) {}

  /**
   * Compute colour-classified route variants for the navigation feature.
   * Proxies GraphHopper so the app never holds routing-engine credentials and
   * always receives ready-to-draw segments + maneuver instructions.
   */
  @Post("route")
  async route(@CurrentUser() user: RequestUser, @Body() dto: RouteRequestDto): Promise<RouteResponse> {
    const points = dto.points.map(validatePoint);
    return this.routingService.route(dto.profile, points, dto.alternatives ?? 3, {
      eventId: user.eventId,
      avoidIncomingTraffic: dto.avoidIncomingTraffic,
      vehicleType: dto.vehicleType,
    });
  }

  /**
   * Reach: everywhere this vehicle can get to from a point inside a time
   * budget, as nested polygons. Used by the deployment planner to decide which
   * stretches of course a posted medic actually covers — a ridge between them
   * and the course counts against them here, which a radius cannot express.
   */
  @Post("isochrone")
  async isochrone(
    @Body() body: { lat: number; lng: number; minutes?: number; vehicleType?: VehicleType; buckets?: number },
  ) {
    const point = validatePoint([Number(body.lng), Number(body.lat)], 0);
    const minutes = Number(body.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) {
      throw new BadRequestException("minutes must be between 1 and 240");
    }
    const vehicleType = (VEHICLE_TYPES as string[]).includes(String(body.vehicleType))
      ? (body.vehicleType as VehicleType)
      : DEFAULT_VEHICLE_TYPE;
    const buckets = Number.isFinite(Number(body.buckets)) ? Number(body.buckets) : 3;
    return this.routingService.isochrone(vehicleType, point, minutes, buckets);
  }

  /**
   * What can drive each stretch of a course.
   *
   * The planner sends the course it has already loaded rather than an id: the
   * GPX lives with the event's files, the client has parsed it, and shipping
   * the geometry costs one request against the backend re-fetching and
   * re-parsing the same track on every call.
   */
  @Post("track-access")
  async courseAccess(@Body() body: { coordinates?: unknown; bins?: number }) {
    if (!Array.isArray(body.coordinates) || body.coordinates.length < 2) {
      throw new BadRequestException("coordinates must be a [lng, lat] line of at least two points");
    }
    if (body.coordinates.length > 20000) {
      throw new BadRequestException("course is too long to classify — send it simplified");
    }
    const coordinates = body.coordinates.map(validatePoint);
    const bins = Math.max(8, Math.min(240, Math.round(Number(body.bins) || 96)));
    return this.trackAccess.report(coordinates, bins);
  }

  /** Nearest paved-road access points around a location (e.g. an incident).  /** Nearest paved-road access points around a location (e.g. an incident).
   *  `from` (the caller's position) adds a by-car leg per point. */
  @Post("closest-asphalt")
  async closestAsphalt(
    @Body() body: { lat: number; lng: number; from?: { lat: number; lng: number } },
  ) {
    const point = validatePoint([Number(body.lng), Number(body.lat)], 0);
    const from =
      body.from && Number.isFinite(Number(body.from.lat)) && Number.isFinite(Number(body.from.lng))
        ? validatePoint([Number(body.from.lng), Number(body.from.lat)], 1)
        : undefined;
    return this.exitPoints.closestAsphalt(point, from);
  }

  /**
   * The five medics who can reach a point soonest, each routed on their own
   * vehicle's network. `incidentId` marks the ones already responding.
   */
  @Post("closest-medics")
  async closestMedics(
    @CurrentUser() user: RequestUser,
    @Body() body: { lat: number; lng: number; incidentId?: string; excludeMedicId?: string },
  ) {
    const point = validatePoint([Number(body.lng), Number(body.lat)], 0);
    return this.closestMedicsService.closestMedics(user.eventId, point, {
      incidentId: typeof body.incidentId === "string" ? body.incidentId : undefined,
      excludeMedicId: typeof body.excludeMedicId === "string" ? body.excludeMedicId : undefined,
    });
  }
}

/** Guard against malformed `[lng, lat]` pairs the class-validator tuple can't reach. */
function validatePoint(point: unknown, index: number): LngLat {
  if (!Array.isArray(point) || point.length < 2) {
    throw new BadRequestException(`Point ${index} must be a [lng, lat] pair.`);
  }
  const lng = Number(point[0]);
  const lat = Number(point[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new BadRequestException(`Point ${index} has out-of-range coordinates.`);
  }
  return [lng, lat];
}
