import { Module } from "@nestjs/common";
import { CoverageController } from "./coverage.controller";
import { CoverageProbeController } from "./coverage-probe.controller";
import { CoverageService } from "./coverage.service";
import { SignalRecorderService } from "./signal-recorder.service";

/**
 * The signal coverage survey.
 *
 * Imports nothing on purpose. The recorder is consumed by MedicsModule, which
 * sits inside the Events ↔ EventChat ↔ Incidents ↔ Medics cycle; importing any
 * module from that cluster here makes this one part of the cycle too, and the
 * first `import` statement to reach it wins — which is a module-ordering bug
 * waiting to happen rather than a design. Everything this module needs comes
 * from the @Global infra module.
 *
 * The one thing that tempted us in was event titles for the filter list. Those
 * are resolved on the dashboard, which already holds the event list.
 */
@Module({
  controllers: [CoverageController, CoverageProbeController],
  providers: [CoverageService, SignalRecorderService],
  exports: [SignalRecorderService],
})
export class CoverageModule {}
