import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { RoutingController } from "./routing.controller";
import { RoutingService } from "./routing.service";

@Module({
  imports: [EventsModule],
  controllers: [RoutingController],
  providers: [RoutingService],
})
export class RoutingModule {}
