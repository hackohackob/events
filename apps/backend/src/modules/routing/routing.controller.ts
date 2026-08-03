import { BadRequestException, Body, Controller, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types/request-user.type";
import { RouteRequestDto } from "./dto/route-request.dto";
import { ClosestMedicsService } from "./closest-medics.service";
import { ExitPointsService } from "./exit-points.service";
import { RoutingService } from "./routing.service";
import type { LngLat, RouteResponse } from "./routing.types";

@Controller("routing")
@UseGuards(AuthGuard)
export class RoutingController {
  constructor(
    private readonly routingService: RoutingService,
    private readonly exitPoints: ExitPointsService,
    private readonly closestMedicsService: ClosestMedicsService,
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

  /** Nearest paved-road access points around a location (e.g. an incident).
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
