import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { TrailsController } from "./trails.controller";
import { TrailsService } from "./trails.service";
import { TrailRecorderService } from "./trail-recorder.service";

/**
 * Deliberately depends on nothing but the shared infra module. The recorder is
 * consumed by MedicsModule, so pulling MedicsModule in here to reach the roster
 * would make the pair circular — the two name/vehicle lookups the read path
 * needs are done as direct queries instead.
 */
@Module({
  // EventsModule supplies the recording gate and the archive window. It is safe
  // to import directly: events reaches neither medics nor trails, so the
  // Medics → Trails → Events chain is a diamond, not a cycle.
  imports: [EventsModule],
  controllers: [TrailsController],
  providers: [TrailsService, TrailRecorderService],
  exports: [TrailRecorderService],
})
export class TrailsModule {}
