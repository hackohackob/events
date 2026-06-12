import { Module, forwardRef } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { MedicsModule } from "../medics/medics.module";
import { IncidentsController } from "./incidents.controller";
import { IncidentsService } from "./incidents.service";

@Module({
  // forwardRef: MedicsModule imports IncidentsModule too (mutual dependency).
  imports: [NotificationsModule, forwardRef(() => MedicsModule)],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
