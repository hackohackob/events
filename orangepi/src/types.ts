/**
 * The wire contract with the events server.
 *
 * Deliberately a local copy of the relevant slice of `@events/contracts` rather
 * than an import: this folder is installed on the appliance on its own, with no
 * monorepo around it. Keep it in step with
 * `packages/contracts/src/index.ts` — the radio gateway section — whenever the
 * server side changes. `delivery.md` lists this as a release checklist item.
 */

export type NetMode = "boot" | "ap" | "client" | "ap+client" | "offline";

export type CommandType =
  | "enter_ap"
  | "leave_ap"
  | "set_event"
  | "test_tx"
  | "restart"
  | "reboot"
  | "update";

export interface GatewayCommand {
  id: string;
  type: CommandType;
  arg?: string;
  issuedAt: string;
  issuedBy?: string;
}

export type PttBackendName = "vox" | "gpio" | "cm108" | "none";

export interface AudioState {
  captureDevice?: string;
  playbackDevice?: string;
  rxLevel: number;
  txLevel: number;
  receiving: boolean;
  transmitting: boolean;
  pttBackend: PttBackendName;
  pttError?: string;
}

export interface HealthState {
  uptimeS: number;
  cpuTempC?: number;
  loadAvg?: number;
  diskFreeMb?: number;
  queued: number;
}

export interface EventOption {
  id: string;
  name: string;
  status: string;
  startsAt?: string;
}

export interface ReportRequest {
  id: string;
  name: string;
  version: string;
  netMode: NetMode;
  ssid?: string;
  signal?: number;
  localIp?: string;
  audio: AudioState;
  health: HealthState;
  counters: { inbound: number; outbound: number };
}

export interface ReportResponse {
  ok: true;
  serverTime: string;
  eventId?: string;
  events: EventOption[];
  routes: { inbound: boolean; outbound: boolean };
  ttsEnabled: boolean;
  commands: GatewayCommand[];
  latestVersion?: string;
}

/** One thing the server wants put on the air. */
export interface OutboundItem {
  id: string;
  at: string;
  kind: "voice" | "text";
  author: string;
  audioUrl?: string;
  text?: string;
}

/** A transmission as the box's own console lists it. */
export interface Recording {
  id: string;
  direction: "rx" | "tx";
  at: string;
  durationMs: number;
  /** Local file under the recordings dir. */
  file: string;
  peakLevel: number;
  party?: string;
  text?: string;
  /** rx only: whether the server accepted it (false while queued offline). */
  uploaded?: boolean;
}
