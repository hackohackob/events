import { Module, forwardRef } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { MedicsModule } from "../medics/medics.module";
import { EventChatModule } from "../event-chat/event-chat.module";
import { IncidentsController } from "./incidents.controller";
import { IncidentsService } from "./incidents.service";
import { TranscriptionService } from "./transcription.service";

@Module({
  // forwardRef: MedicsModule imports IncidentsModule too (mutual dependency).
  imports: [NotificationsModule, forwardRef(() => MedicsModule), EventChatModule],
  controllers: [IncidentsController],
  providers: [IncidentsService, TranscriptionService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
