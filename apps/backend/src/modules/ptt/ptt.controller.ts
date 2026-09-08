import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import type {
  PttChannelKind,
  PttEventRoutes,
  PttOverview,
  PttProviderStatus,
  RadioGatewayCommandType,
  RadioGatewayStatus,
  RadioGatewayTransmission,
  UpdatePttProviderRequest,
  UpdatePttRouteRequest,
  UpdateRadioGatewayRequest,
} from "@events/contracts";
import { PTT_CHANNEL_KINDS } from "@events/contracts";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { RequestUser } from "../common/types/request-user.type";
import { PttBridgeService } from "./ptt-bridge.service";
import { PttSettingsService } from "./ptt-settings.service";
import { RadioGatewayService } from "./providers/radio/radio-gateway.service";

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
    private readonly gateways: RadioGatewayService,
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

  // ── Radio gateway fleet ────────────────────────────────────────────────────

  /**
   * The gateway boxes. Staff roles can see them — knowing whether the radio
   * bridge is actually alive matters in the field — but only a coordinator can
   * change a binding or send a command.
   */
  @Get("gateways")
  @Roles("paramedic", "coordinator", "medic")
  gateways_(): Promise<RadioGatewayStatus[]> {
    return this.gateways.list();
  }

  @Get("gateways/transmissions")
  @Roles("paramedic", "coordinator", "medic")
  gatewayTransmissions(
    @Query("gatewayId") gatewayId?: string,
    @Query("limit") limit?: string,
  ): Promise<RadioGatewayTransmission[]> {
    return this.gateways.transmissionsFor(gatewayId?.trim() || undefined, Number(limit) || 100);
  }

  @Put("gateways/:id")
  @Roles("coordinator")
  async updateGateway(
    @Param("id") id: string,
    @Body() body: UpdateRadioGatewayRequest,
  ): Promise<RadioGatewayStatus> {
    const next = await this.gateways.update(id, body);
    if (!next) throw new BadRequestException("unknown gateway");
    return next;
  }

  /**
   * Send the box an instruction. This is how a gateway that has already joined
   * the venue WiFi is brought back into access-point mode — nobody can reach it
   * over the network any more, so the command waits for its next check-in.
   */
  @Post("gateways/:id/command")
  @Roles("coordinator")
  async commandGateway(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: { type: RadioGatewayCommandType; arg?: string },
  ): Promise<{ ok: true; queuedAt: string }> {
    const allowed: RadioGatewayCommandType[] = [
      "enter_ap",
      "leave_ap",
      "set_event",
      "test_tx",
      "restart",
      "reboot",
      "update",
    ];
    if (!allowed.includes(body?.type)) throw new BadRequestException("unknown command");
    const queued = await this.gateways.command(id, body.type, body.arg, user.userId);
    if (!queued) throw new BadRequestException("unknown gateway");
    return { ok: true, queuedAt: queued.issuedAt };
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
