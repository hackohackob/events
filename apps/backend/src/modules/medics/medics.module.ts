import { Module, forwardRef } from "@nestjs/common";
import { MedicsController } from "./medics.controller";
import { MedicsGateway } from "./medics.gateway";
import { MedicsService } from "./medics.service";
import { MedicSilenceService } from "./medic-silence.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { IncidentsModule } from "../incidents/incidents.module";
import { EventsModule } from "../events/events.module";
import { TrailsModule } from "../trails/trails.module";
import { CoverageModule } from "../coverage/coverage.module";
import { LocationDiagnosticsModule } from "../location-diagnostics/location-diagnostics.module";

@Module({
  // forwardRef: IncidentsService injects MedicsService (mutual dependency).
  imports: [NotificationsModule, forwardRef(() => IncidentsModule), EventsModule, TrailsModule, CoverageModule, LocationDiagnosticsModule],
  controllers: [MedicsController],
  providers: [MedicsService, MedicsGateway, MedicSilenceService],
  exports: [MedicsService],
})
export class MedicsModule {}
