import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { LocationDiagnosticsController } from "./location-diagnostics.controller";
import { LocationDiagnosticsService } from "./location-diagnostics.service";

/**
 * Imports only NotificationsModule (a leaf). MedicsModule consumes the tuning
 * for its location POST response, so reaching back into medics from here
 * would make the pair circular.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [LocationDiagnosticsController],
  providers: [LocationDiagnosticsService],
  exports: [LocationDiagnosticsService],
})
export class LocationDiagnosticsModule {}
