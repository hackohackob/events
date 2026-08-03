import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { IncidentsModule } from "../incidents/incidents.module";
import { MedicsModule } from "../medics/medics.module";
import { ClosestMedicsService } from "./closest-medics.service";
import { ExitPointsService } from "./exit-points.service";
import { GraphHopperClient } from "./graphhopper.client";
import { RoutingController } from "./routing.controller";
import { RoutingService } from "./routing.service";

@Module({
  // Nothing imports RoutingModule, so pulling in medics + incidents (for the
  // closest-medic search) introduces no cycle.
  imports: [EventsModule, MedicsModule, IncidentsModule],
  controllers: [RoutingController],
  providers: [GraphHopperClient, RoutingService, ExitPointsService, ClosestMedicsService],
})
export class RoutingModule {}
