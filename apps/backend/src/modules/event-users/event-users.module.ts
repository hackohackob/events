import { Module } from "@nestjs/common";
import { EventUsersController } from "./event-users.controller";
import { EventUsersService } from "./event-users.service";

@Module({
  controllers: [EventUsersController],
  providers: [EventUsersService],
  exports: [EventUsersService],
})
export class EventUsersModule {}
