import { Module } from "@nestjs/common";
import { EventChatModule } from "../event-chat/event-chat.module";
import { EventsModule } from "../events/events.module";
import { TranscriptionService } from "../incidents/transcription.service";
import { PttBridgeService } from "./ptt-bridge.service";
import { PttController } from "./ptt.controller";
import { PttMediaService } from "./ptt-media.service";
import { PttSettingsService } from "./ptt-settings.service";
import { RadioBundleService } from "./providers/radio/radio-bundle.service";
import { RadioGatewayController } from "./providers/radio/radio-gateway.controller";
import { RadioGatewayService } from "./providers/radio/radio-gateway.service";
import { RadioProvider } from "./providers/radio/radio.provider";
import { ZelloProvider } from "./providers/zello/zello.provider";
import { TtsService } from "./tts.service";

/**
 * Push-to-talk bridges. Registering a new network means adding its provider to
 * `providers` here and to `PTT_CHANNEL_KINDS` in the contracts — the bridge,
 * the REST layer and both settings UIs pick it up from there.
 *
 * The radio bridge brings a second controller: `RadioGatewayController` serves
 * the appliances in `orangepi/`, which authenticate with a shared key instead
 * of a user session and so cannot live behind the app's guards.
 */
@Module({
  imports: [EventsModule, EventChatModule],
  controllers: [PttController, RadioGatewayController],
  providers: [
    PttBridgeService,
    PttSettingsService,
    PttMediaService,
    TranscriptionService,
    TtsService,
    ZelloProvider,
    RadioProvider,
    RadioGatewayService,
    RadioBundleService,
  ],
  exports: [PttBridgeService],
})
export class PttModule {}
