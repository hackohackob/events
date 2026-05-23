import { Module } from "@nestjs/common";
import { MedicsController } from "./medics.controller";
import { MedicsGateway } from "./medics.gateway";
import { MedicsService } from "./medics.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [MedicsController],
  providers: [MedicsService, MedicsGateway],
  exports: [MedicsService],
})
export class MedicsModule {}
