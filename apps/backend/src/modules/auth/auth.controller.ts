import { Body, Controller, Post } from "@nestjs/common";
import { JoinEventDto } from "./dto/join-event.dto";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("join")
  join(@Body() body: JoinEventDto) {
    return this.authService.joinEvent(body);
  }
}
