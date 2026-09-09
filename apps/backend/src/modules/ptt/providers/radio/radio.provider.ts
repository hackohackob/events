import { Injectable } from "@nestjs/common";
import type { PttCapabilities, PttChannelKind, PttConfigField } from "@events/contracts";
import type {
  OutboundPttMessage,
  PttProvider,
  PttProviderEvents,
  PttProviderRuntimeStatus,
} from "../ptt-provider";
import { RadioGatewayService } from "./radio-gateway.service";

/**
 * Digital radio bridge, served by the gateway appliances in `orangepi/`.
 *
 * Unlike Zello there is no connection to hold here: the boxes dial in, and this
 * provider is the server end of that fleet. `send` therefore does not transmit
 * — it queues the item on every online box bound to the message's event, and
 * the box does the keying and the playing.
 *
 * The air link carries voice only. Text is transmitted as speech, and only for
 * gateways whose operator switched TTS on — an always-on robot reading every
 * chat line would make the channel unusable.
 */
@Injectable()
export class RadioProvider implements PttProvider {
  readonly kind: PttChannelKind = "radio";
  readonly label = "Digital radio";
  readonly description =
    "Bridges the team chat to a Hytera handset through a gateway box on the venue's WiFi. Voice both ways; text is spoken over the air when a gateway has speech turned on.";
  readonly available = true;
  // No path over the air for images, and position reports would need the
  // handset's data channel rather than its audio jack.
  readonly capabilities: PttCapabilities = { text: true, voice: true, image: false, location: false };
  readonly fanOutPerEvent = true;
  readonly fields: PttConfigField[] = [
    {
      key: "gatewayKey",
      label: "Gateway key",
      type: "secret",
      required: true,
      hint: "Shared secret every gateway box must present. Copy it into the box's setup screen — that is the whole enrolment.",
    },
    {
      key: "callSign",
      label: "Base call sign",
      type: "text",
      required: false,
      placeholder: "BASE",
      hint: "Spoken before app messages so radio users know the transmission came from the command centre.",
    },
  ];

  private events: PttProviderEvents | null = null;
  private enabled = false;
  private key = "";

  constructor(private readonly gateways: RadioGatewayService) {
    this.gateways.bind(() => this.events?.onStatus());
  }

  bind(events: PttProviderEvents): void {
    this.events = events;
  }

  isConfigured(config: Record<string, string>): boolean {
    return Boolean(config.gatewayKey?.trim());
  }

  apply(enabled: boolean, config: Record<string, string>): Promise<void> {
    this.enabled = enabled;
    this.key = config.gatewayKey?.trim() ?? "";
    this.events?.onStatus();
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.enabled = false;
    return Promise.resolve();
  }

  /** Checked by the device controller on every request from a box. */
  accepts(key: string): boolean {
    return this.enabled && this.key.length > 0 && key === this.key;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  callSign(config: Record<string, string>): string {
    return config.callSign?.trim() || "BASE";
  }

  status(): PttProviderRuntimeStatus {
    if (!this.enabled) return { state: "disabled" };
    if (!this.key) return { state: "error", detail: "No gateway key set — boxes cannot authenticate." };
    const { total, online } = this.gateways.count();
    if (total === 0) {
      return { state: "connecting", detail: "Waiting for a gateway box to check in." };
    }
    if (online === 0) {
      return { state: "offline", detail: `${total} gateway${total === 1 ? "" : "s"} known, none reachable.` };
    }
    return {
      state: "online",
      detail: `${online} of ${total} gateway${total === 1 ? "" : "s"} online.`,
      usersOnline: online,
      channel: "Radio gateways",
    };
  }

  async send(message: OutboundPttMessage): Promise<void> {
    if (!this.enabled) throw new Error("radio bridge is switched off");
    const eventId = message.eventId;
    if (!eventId) throw new Error("radio messages must name an event");

    if (message.kind === "voice") {
      // The box has ffmpeg and decodes the app's m4a itself, so the file goes
      // over as-is rather than being transcoded once per gateway here.
      if (!message.audioUrl) throw new Error("voice message has no downloadable URL");
      const sent = this.gateways.deliver(eventId, {
        kind: "voice",
        author: message.author,
        audioUrl: message.audioUrl,
        text: message.transcript,
      });
      if (sent === 0) throw new Error("no gateway online for this event");
      return;
    }

    if (message.kind === "text") {
      const sent = this.gateways.deliver(eventId, {
        kind: "text",
        author: message.author,
        text: message.text,
      });
      // Not an error worth surfacing: with speech off this is the normal case.
      if (sent === 0) throw new Error("no gateway online for this event");
      return;
    }

    throw new Error(`${message.kind} cannot be sent over the air`);
  }
}
