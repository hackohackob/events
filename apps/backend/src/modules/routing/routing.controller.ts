import { BadRequestException, Body, Controller, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types/request-user.type";
import { RouteRequestDto } from "./dto/route-request.dto";
import { RoutingService } from "./routing.service";
import type { LngLat, RouteResponse } from "./routing.types";

@Controller("routing")
@UseGuards(AuthGuard)
export class RoutingController {
  constructor(private readonly routingService: RoutingService) {}

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
