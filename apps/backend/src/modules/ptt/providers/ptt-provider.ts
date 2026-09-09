import type {
  PttCapabilities,
  PttChannelKind,
  PttConfigField,
  PttConnectionState,
} from "@events/contracts";

/**
 * The contract every PTT network implements. The bridge, the REST layer and
 * both settings UIs only ever talk to this — adding the digital radio gateway
 * means writing one class here and registering it, with no changes upstream.
 */

/**
 * A message coming *in* from an external network, on its way to the team chat.
 *
 * `eventId` narrows delivery to one event. Zello leaves it unset — one account
 * bridges every active event at once — while a radio gateway sets it, because a
 * box is physically wired to one handset at one venue and its traffic belongs
 * to that event alone.
 */
export type InboundPttBase = { from: string; eventId?: string };
export type InboundPttMessage = InboundPttBase &
  (
    | { kind: "text"; text: string }
    | { kind: "voice"; audio: Buffer; extension: string; durationMs: number }
    | { kind: "image"; full: Buffer; thumbnail?: Buffer; extension: string }
    | { kind: "location"; lat: number; lng: number; address?: string; accuracyM?: number }
  );

/**
 * A message going *out* from the team chat to an external network.
 *
 * `eventId` says which event it came from. Zello ignores it; the radio bridge
 * uses it to pick the gateways bound to that event. `audioUrl` sits alongside
 * `audioPath` for providers that hand the file to a remote client to fetch
 * rather than reading it themselves.
 */
export type OutboundPttBase = { author: string; eventId?: string };
export type OutboundPttMessage = OutboundPttBase &
  (
    | { kind: "text"; text: string }
    | { kind: "voice"; audioPath: string; audioUrl?: string; transcript?: string }
    | { kind: "image"; imagePath: string; caption?: string }
    | { kind: "location"; lat: number; lng: number; address?: string; accuracyM?: number }
  );

export interface PttProviderRuntimeStatus {
  state: PttConnectionState;
  detail?: string;
  channel?: string;
  usersOnline?: number;
  connectedAt?: string;
}

export interface PttProviderEvents {
  onMessage: (message: InboundPttMessage) => void;
  onStatus: () => void;
  onLog: (level: "info" | "warn" | "error", message: string) => void;
}

export interface PttProvider {
  readonly kind: PttChannelKind;
  readonly label: string;
  readonly description: string;
  /** False while a provider is scaffolded but not wired to a real network yet. */
  readonly available: boolean;
  readonly capabilities: PttCapabilities;
  /** Drives the connection form in the dashboard. */
  readonly fields: PttConfigField[];
  /**
   * Whether one message has to be sent once per event, or once for the whole
   * network. Zello is a single account on a single channel, so a message goes
   * out once no matter how many events are bridged; the radio fleet is the
   * opposite — each box is bound to one event and has to be addressed
   * individually. Only the relay path needs to know the difference.
   */
  readonly fanOutPerEvent: boolean;

  bind(events: PttProviderEvents): void;
  /** Whether the given config has every required field. */
  isConfigured(config: Record<string, string>): boolean;
  /** Connect (or reconnect with new settings). */
  apply(enabled: boolean, config: Record<string, string>): Promise<void>;
  shutdown(): Promise<void>;
  status(): PttProviderRuntimeStatus;
  /** Throws when the message cannot be delivered. */
  send(message: OutboundPttMessage): Promise<void>;
}

/** `true` iso timestamp helper shared by providers. */
export function nowIso(): string {
  return new Date().toISOString();
}
