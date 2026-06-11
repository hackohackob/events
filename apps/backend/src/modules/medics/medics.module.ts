import { Module } from "@nestjs/common";
import { MedicsController } from "./medics.controller";
import { MedicsGateway } from "./medics.gateway";
import { MedicsService } from "./medics.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { IncidentsModule } from "../incidents/incidents.module";

@Module({
  imports: [NotificationsModule, IncidentsModule],
  controllers: [MedicsController],
  providers: [MedicsService, MedicsGateway],
  exports: [MedicsService],
})
export class MedicsModule {}
