import { Module, forwardRef } from "@nestjs/common";
import { IncidentsModule } from "../incidents/incidents.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TranscriptionService } from "../incidents/transcription.service";
import { EventChatController } from "./event-chat.controller";
import { EventChatService } from "./event-chat.service";

@Module({
  // forwardRef: IncidentsModule imports this one too — incidents post feed
  // entries into the team chat, and nearby team-chat messages are mirrored back
  // onto incidents.
  imports: [NotificationsModule, forwardRef(() => IncidentsModule)],
  controllers: [EventChatController],
  providers: [EventChatService, TranscriptionService],
  exports: [EventChatService],
})
export class EventChatModule {}
