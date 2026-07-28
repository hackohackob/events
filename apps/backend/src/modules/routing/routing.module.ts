import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { ExitPointsService } from "./exit-points.service";
import { GraphHopperClient } from "./graphhopper.client";
import { RoutingController } from "./routing.controller";
import { RoutingService } from "./routing.service";

@Module({
  imports: [EventsModule],
  controllers: [RoutingController],
  providers: [GraphHopperClient, RoutingService, ExitPointsService],
})
export class RoutingModule {}
