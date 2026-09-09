/**
 * The console's view of the box. Types mirror what `src/daemon.ts` returns;
 * every call goes to the box itself, never to the internet — the phone running
 * this page usually has none.
 */

export interface NetworkState {
  mode: "boot" | "ap" | "client" | "ap+client" | "offline";
  ssid?: string;
  signal?: number;
  ip?: string;
  apUntil?: string;
  lastError?: string;
  online: boolean;
}

export interface RadioState {
  captureDevice?: string;
  playbackDevice?: string;
  rxLevel: number;
  txLevel: number;
  receiving: boolean;
  transmitting: boolean;
  pttBackend: "vox" | "gpio" | "cm108" | "none";
  pttError?: string;
}

export interface EventOption {
  id: string;
  name: string;
  status: string;
  startsAt?: string;
}

export interface Status {
  id: string;
  name: string;
  version: string;
  provisioned: boolean;
  activity: string;
  network: NetworkState;
  radio: RadioState;
  queueLength: number;
  liveKeyed: boolean;
  server: {
    connected: boolean;
    url: string;
    lastReportAt?: string;
    lastError?: string;
    routes: { inbound: boolean; outbound: boolean };
    ttsEnabled: boolean;
    queued: number;
    latestVersion?: string;
    updateAvailable: boolean;
  };
  event: { id: string | null; name?: string; options: EventOption[] };
  health: { uptimeS: number; cpuTempC?: number; loadAvg?: number; diskFreeMb?: number; queued: number };
  storage: { recordings: number; bytes: number; maxMb: number };
}

export interface LogEntry {
  seq: number;
  at: string;
  level: "debug" | "info" | "warn" | "error";
  scope: string;
  message: string;
  data?: Record<string, string | number | boolean>;
}

export interface Recording {
  id: string;
  direction: "rx" | "tx";
  at: string;
  durationMs: number;
  file: string;
  peakLevel: number;
  party?: string;
  text?: string;
  uploaded?: boolean;
}

export interface WifiNetwork {
  ssid: string;
  signal: number;
  security: string;
  known: boolean;
  active: boolean;
}

export interface AudioDevice {
  id: string;
  label: string;
  card: number;
  device: number;
  recommended: boolean;
}

export interface GatewayConfig {
  id: string;
  name: string;
  serverUrl: string;
  gatewayKeySet: boolean;
  eventId: string | null;
  ap: { ssid: string; password: string; countryCode: string; keepWithClient: boolean; onDemandMinutes: number };
  audio: { capture: string; playback: string; inputGain: number; outputGain: number };
  squelch: {
    openLevel: number;
    closeLevel: number;
    hangMs: number;
    minDurationMs: number;
    maxDurationMs: number;
  };
  ptt: {
    backend: "vox" | "gpio" | "cm108" | "none";
    gpioPin: number;
    activeLow: boolean;
    leadMs: number;
    tailMs: number;
    maxTxMs: number;
    waitForClearMs: number;
  };
  ttsEnabled: boolean;
  storage: { maxMb: number; maxDays: number };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body && !(init.body instanceof ArrayBuffer)
      ? { "Content-Type": "application/json", ...(init?.headers ?? {}) }
      : init?.headers,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

const post = <T,>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  status: () => request<Status>("/status"),
  config: () => request<GatewayConfig>("/config"),
  saveConfig: (patch: unknown) => request<GatewayConfig>("/config", { method: "PUT", body: JSON.stringify(patch) }),
  setup: (body: { serverUrl?: string; gatewayKey?: string; name?: string }) =>
    post<{ ok: boolean; status: Status }>("/setup", body),

  /** Returns `live: false` with a `cachedAt` when served from the AP-mode cache. */
  scanWifi: () =>
    request<{ networks: WifiNetwork[]; cachedAt: string | null; live: boolean }>("/wifi/scan"),
  joinWifi: (ssid: string, password?: string) => post<{ ok: boolean; detail: string }>("/wifi/connect", { ssid, password }),
  forgetWifi: (ssid: string) => post<{ ok: boolean }>("/wifi/forget", { ssid }),
  startAp: (minutes: number) => post<{ ok: boolean; detail: string }>("/wifi/ap", { minutes }),
  leaveAp: () => post<{ ok: boolean; detail: string }>("/wifi/client"),

  selectEvent: (eventId: string | null) => post<{ ok: boolean; confirmed: boolean; status: Status }>("/event", { eventId }),
  checkIn: () => post<{ ok: boolean; status: Status }>("/check-in"),
  retryQueue: () => post<{ ok: boolean; sent: number }>("/retry-queue"),

  audioDevices: () => request<{ capture: AudioDevice[]; playback: AudioDevice[] }>("/audio/devices"),
  testTone: () => post<{ ok: boolean; detail: string }>("/radio/test-tone"),
  verifyPtt: () => post<{ ok: boolean; detail: string }>("/radio/verify-ptt"),
  cancelTx: () => post<{ ok: boolean }>("/radio/cancel"),

  pttStart: () => post<{ ok: boolean; detail?: string }>("/radio/ptt/start"),
  pttStop: () => post<{ ok: boolean; durationMs: number }>("/radio/ptt/stop"),
  pttAudio: (pcm: ArrayBuffer) =>
    fetch("/api/radio/ptt/audio", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: pcm,
    }),

  recordings: (direction?: "rx" | "tx") =>
    request<Recording[]>(`/recordings${direction ? `?direction=${direction}` : ""}`),
  clearRecordings: () => request<{ ok: boolean }>("/recordings", { method: "DELETE" }),

  logs: (after = 0) => request<LogEntry[]>(`/logs?after=${after}`),
  update: () => post<{ ok: boolean; detail: string }>("/update"),
  restart: () => post<{ ok: boolean; detail: string }>("/restart"),
  reboot: () => post<{ ok: boolean; detail: string }>("/reboot"),
};

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "14:32" for today, "Mon 14:32" this week, a date beyond that. */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  if (now.getTime() - date.getTime() < 6 * 86400_000) {
    return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
  }
  return `${date.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}
