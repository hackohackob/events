import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import type {
  PttChannelKind,
  PttEventRoutes,
  PttOverview,
  PttProviderStatus,
  UpdatePttProviderRequest,
  UpdatePttRouteRequest,
} from "@events/contracts";
import { PTT_CHANNEL_KINDS } from "@events/contracts";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { RequestUser } from "../common/types/request-user.type";
import { PttBridgeService } from "./ptt-bridge.service";
import { PttSettingsService } from "./ptt-settings.service";

/**
 * Two audiences, two levels of access:
 *   • `/ptt/providers*` — connection settings for the whole server. Dashboard
 *     only; the responses never contain secret values.
 *   • `/ptt/routes*` — the per-event forwarding switches a coordinator flips
 *     from the field app.
 */
@Controller("ptt")
@UseGuards(AuthGuard, RolesGuard)
export class PttController {
  constructor(
    private readonly bridge: PttBridgeService,
    private readonly settings: PttSettingsService,
  ) {}

  @Get("providers")
  @Roles("coordinator")
  overview(): Promise<PttOverview> {
    return this.bridge.overview();
  }

  @Get("status")
  @Roles("paramedic", "coordinator", "medic")
  status(): Promise<PttProviderStatus[]> {
    return this.bridge.statuses();
  }

  @Get("activity")
  @Roles("coordinator")
  activity(): Array<{ at: string; kind: string; level: string; message: string }> {
    return this.bridge.recentActivity();
  }

  @Put("providers/:kind")
  @Roles("coordinator")
  update(@Param("kind") kind: string, @Body() body: UpdatePttProviderRequest): Promise<PttOverview> {
    return this.bridge.updateProvider(assertKind(kind), body);
  }

  @Post("providers/:kind/test")
  @Roles("coordinator")
  async test(@Param("kind") kind: string, @Body() body: { text?: string }): Promise<{ ok: true }> {
    await this.bridge.sendTest(assertKind(kind), body.text?.trim() || "Radio check from the command centre.");
    return { ok: true };
  }

  /**
   * Forwarding switches for one event. `eventId` defaults to the caller's own
   * event, which is what the field app relies on.
   */
  @Get("routes")
  @Roles("paramedic", "coordinator", "medic")
  routes(@CurrentUser() user: RequestUser, @Query("eventId") eventId?: string): Promise<PttEventRoutes> {
    return this.settings.routes(eventId?.trim() || user.eventId);
  }

  @Put("routes")
  @Roles("coordinator")
  setRoute(
    @CurrentUser() user: RequestUser,
    @Body() body: UpdatePttRouteRequest & { eventId?: string },
  ): Promise<PttEventRoutes> {
    return this.settings.setRoute(body.eventId?.trim() || user.eventId, assertKind(body.kind), {
      inbound: body.inbound,
      outbound: body.outbound,
    });
  }
}

function assertKind(value: string): PttChannelKind {
  if (!(PTT_CHANNEL_KINDS as string[]).includes(value)) {
    throw new BadRequestException(`unknown PTT channel "${value}"`);
  }
  return value as PttChannelKind;
}
