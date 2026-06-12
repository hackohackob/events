import { Module, forwardRef } from "@nestjs/common";
import { MedicsController } from "./medics.controller";
import { MedicsGateway } from "./medics.gateway";
import { MedicsService } from "./medics.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { IncidentsModule } from "../incidents/incidents.module";

@Module({
  // forwardRef: IncidentsService injects MedicsService (mutual dependency).
  imports: [NotificationsModule, forwardRef(() => IncidentsModule)],
  controllers: [MedicsController],
  providers: [MedicsService, MedicsGateway],
  exports: [MedicsService],
})
export class MedicsModule {}
