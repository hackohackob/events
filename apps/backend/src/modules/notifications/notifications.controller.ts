import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { AuthGuard } from "../common/guards/auth.guard";
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
}
