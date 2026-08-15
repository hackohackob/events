import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types/request-user.type";
import { NotificationsService } from "./notifications.service";

class RegisterTokenDto {
  @IsString()
  token!: string;

  @IsOptional()
  @IsString()
  platform?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

class UnregisterTokenDto {
  @IsString()
  token!: string;
}

@Controller("notifications")
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post("token")
  registerToken(@CurrentUser() user: RequestUser, @Body() body: RegisterTokenDto) {
    return this.notificationsService.registerToken(
      user.userId,
      user.eventId,
      body.token,
      body.platform,
      body.deviceId,
    );
  }

  /**
   * Called by the app when the user leaves an event. POST rather than DELETE
   * because the token travels in the body and proxies are free to strip a
   * DELETE body.
   */
  @Post("token/unregister")
  unregisterToken(@Body() body: UnregisterTokenDto) {
    return this.notificationsService.unregisterToken(body.token);
  }

  /** Dashboard: every device that would ring on an incident. */
  @Get("subscriptions")
  @UseGuards(RolesGuard)
  @Roles("coordinator")
  listSubscriptions(@Query("eventId") eventId?: string) {
    return this.notificationsService.listSubscriptions(eventId);
  }

  /**
   * Dashboard: unsubscribe every device (optionally just one event's). Safe —
   * a phone re-registers by itself the next time it opens the app.
   */
  @Delete("subscriptions")
  @UseGuards(RolesGuard)
  @Roles("coordinator")
  clearSubscriptions(@Query("eventId") eventId?: string) {
    return this.notificationsService.clearSubscriptions(eventId);
  }

  @Delete("subscriptions/:id")
  @UseGuards(RolesGuard)
  @Roles("coordinator")
  deleteSubscription(@Param("id") id: string) {
    return this.notificationsService.deleteSubscription(id);
  }
}
