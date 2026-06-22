import { Module } from "@nestjs/common";
import { TranscriptionService } from "../incidents/transcription.service";
import { EventChatController } from "./event-chat.controller";
import { EventChatService } from "./event-chat.service";

@Module({
  controllers: [EventChatController],
  providers: [EventChatService, TranscriptionService],
  exports: [EventChatService],
})
export class EventChatModule {}
