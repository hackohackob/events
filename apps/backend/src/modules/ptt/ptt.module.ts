import { Module } from "@nestjs/common";
import { EventChatModule } from "../event-chat/event-chat.module";
import { EventsModule } from "../events/events.module";
import { TranscriptionService } from "../incidents/transcription.service";
import { PttBridgeService } from "./ptt-bridge.service";
import { PttController } from "./ptt.controller";
import { PttMediaService } from "./ptt-media.service";
import { PttSettingsService } from "./ptt-settings.service";
import { RadioProvider } from "./providers/radio/radio.provider";
import { ZelloProvider } from "./providers/zello/zello.provider";

/**
 * Push-to-talk bridges. Registering a new network means adding its provider to
 * `providers` here and to `PTT_CHANNEL_KINDS` in the contracts — the bridge,
 * the REST layer and both settings UIs pick it up from there.
 */
@Module({
  imports: [EventsModule, EventChatModule],
  controllers: [PttController],
  providers: [
    PttBridgeService,
    PttSettingsService,
    PttMediaService,
    TranscriptionService,
    ZelloProvider,
    RadioProvider,
  ],
  exports: [PttBridgeService],
})
export class PttModule {}
