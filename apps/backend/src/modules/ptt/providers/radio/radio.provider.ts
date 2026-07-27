import { Injectable } from "@nestjs/common";
import type { PttCapabilities, PttChannelKind, PttConfigField } from "@events/contracts";
import type {
  OutboundPttMessage,
  PttProvider,
  PttProviderEvents,
  PttProviderRuntimeStatus,
} from "../ptt-provider";

/**
 * Digital radio (DMR / TETRA / Motorola RadioBridge) gateway — scaffolded, not
 * yet wired to hardware.
 *
 * It exists now so the whole chain above it is provider-agnostic in practice
 * and not just in principle: the dashboard renders its connection form, the
 * per-event routing switches already carry a `radio` row, and the app shows the
 * bridge greyed out with a reason. Implementing it means filling in `apply`,
 * `send` and the inbound callbacks — nothing upstream changes.
 *
 * `available: false` is what keeps it from being switched on.
 */
@Injectable()
export class RadioProvider implements PttProvider {
  readonly kind: PttChannelKind = "radio";
  readonly label = "Digital radio";
  readonly description =
    "Gateway to the DMR/TETRA network. Connection details are stored now; the audio path lands with the radio gateway hardware.";
  readonly available = false;
  // Radio carries voice and (via the gateway's data channel) text and GPS
  // position reports. Images have no path over the air.
  readonly capabilities: PttCapabilities = { text: true, voice: true, image: false, location: true };
  readonly fields: PttConfigField[] = [
    {
      key: "gatewayUrl",
      label: "Gateway URL",
      type: "text",
      required: true,
      placeholder: "https://radio-gw.local:8443",
      hint: "Address of the radio gateway appliance on the event network.",
    },
    { key: "talkgroup", label: "Talkgroup", type: "text", required: true, placeholder: "TG-101" },
    { key: "callSign", label: "Bridge call sign", type: "text", required: true, placeholder: "BASE-1" },
    { key: "apiKey", label: "Gateway API key", type: "secret", required: true },
  ];

  private events: PttProviderEvents | null = null;
  private enabled = false;

  bind(events: PttProviderEvents): void {
    this.events = events;
  }

  isConfigured(config: Record<string, string>): boolean {
    return this.fields
      .filter((f) => f.required)
      .every((f) => Boolean(config[f.key]?.trim()));
  }

  apply(enabled: boolean, _config: Record<string, string>): Promise<void> {
    this.enabled = enabled;
    this.events?.onStatus();
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.enabled = false;
    return Promise.resolve();
  }

  status(): PttProviderRuntimeStatus {
    return {
      state: this.enabled ? "offline" : "disabled",
      detail: "Radio gateway integration is not implemented yet.",
    };
  }

  send(_message: OutboundPttMessage): Promise<void> {
    return Promise.reject(new Error("radio gateway not implemented"));
  }
}
