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

/** A message coming *in* from an external network, on its way to the team chat. */
export type InboundPttMessage =
  | { kind: "text"; from: string; text: string }
  | { kind: "voice"; from: string; audio: Buffer; extension: string; durationMs: number }
  | { kind: "image"; from: string; full: Buffer; thumbnail?: Buffer; extension: string }
  | { kind: "location"; from: string; lat: number; lng: number; address?: string; accuracyM?: number };

/** A message going *out* from the team chat to an external network. */
export type OutboundPttMessage =
  | { kind: "text"; author: string; text: string }
  | { kind: "voice"; author: string; audioPath: string; transcript?: string }
  | { kind: "image"; author: string; imagePath: string; caption?: string }
  | { kind: "location"; author: string; lat: number; lng: number; address?: string; accuracyM?: number };

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
