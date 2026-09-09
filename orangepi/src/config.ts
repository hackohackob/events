import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import type { PttBackendName } from "./types";

/**
 * Everything the appliance remembers across reboots, in one JSON file.
 *
 * The state directory is a single place so the whole configuration can be
 * backed up, wiped ("factory reset" in the console) or seeded onto a new SD
 * card by copying one folder. Nothing here lives in the code bundle, so an
 * update never touches a deployed box's settings.
 */
export const STATE_DIR = process.env.GATEWAY_STATE_DIR?.trim() || "/var/lib/em-gateway";
export const CONFIG_PATH = join(STATE_DIR, "config.json");
export const RECORDINGS_DIR = join(STATE_DIR, "recordings");
export const LOG_PATH = join(STATE_DIR, "gateway.log");
export const OUTBOX_DIR = join(STATE_DIR, "outbox");

/** Set by the build; shown in the console and reported to the server. */
export const VERSION: string = readVersion();

export interface GatewayConfig {
  /** Stable per-box identity, derived from the machine-id on first boot. */
  id: string;
  /** Operator-facing name, e.g. "Ambulance 1" or "Finish line". */
  name: string;

  /** Events API root, e.g. https://events-api.academyfirstaid.com/api */
  serverUrl: string;
  /** The shared secret from the dashboard's radio bridge settings. */
  gatewayKey: string;
  /** Which event this handset belongs to. Chosen in setup or from the server. */
  eventId: string | null;

  /** Access point the phone connects to for setup and the console. */
  ap: {
    ssid: string;
    password: string;
    /** Regulatory domain for the access point; hostapd requires one. */
    countryCode: string;
    /**
     * Keep the AP up after joining a network. The Zero 3's AIC8800 usually
     * cannot, which is why the dashboard can summon the AP back instead.
     */
    keepWithClient: boolean;
    /** Minutes the AP stays up when summoned; 0 keeps it up until told to stop. */
    onDemandMinutes: number;
  };

  audio: {
    /** ALSA device strings, e.g. "plughw:1,0". Empty means auto-detect. */
    capture: string;
    playback: string;
    /** Capture gain multiplier applied in software before the squelch. */
    inputGain: number;
    /** Playback gain multiplier applied before aplay. */
    outputGain: number;
  };

  squelch: {
    /** 0–1 RMS above which the channel counts as busy. */
    openLevel: number;
    /** Level to fall back below before the transmission is considered over. */
    closeLevel: number;
    /** Silence to wait through before closing, so pauses do not split a call. */
    hangMs: number;
    /** Ignore blips shorter than this — squelch crashes, key-ups, static. */
    minDurationMs: number;
    /** Hard stop for a stuck-open channel. */
    maxDurationMs: number;
  };

  ptt: {
    backend: PttBackendName;
    /** sysfs GPIO number for the `gpio` backend. */
    gpioPin: number;
    /** True when pulling the line LOW keys the radio (opto-isolators usually do). */
    activeLow: boolean;
    /** Delay between keying up and starting audio, so the repeater opens. */
    leadMs: number;
    /** Delay between the audio ending and unkeying, so the tail is not clipped. */
    tailMs: number;
    /** Refuse to key longer than this, whatever happens. */
    maxTxMs: number;
    /** Wait for the channel to go quiet before transmitting. */
    waitForClearMs: number;
  };

  /** Speak app text over the air. Mirrored from the server, off by default. */
  ttsEnabled: boolean;

  storage: {
    /** Recordings are pruned oldest-first past either limit. */
    maxMb: number;
    maxDays: number;
  };

  /** Console PIN, currently unused — the AP password is the credential. */
  consolePin: string;
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * A stable id that survives reflashing the app but not the OS. Derived from the
 * machine-id so a box keeps its dashboard row (and its event binding) across
 * updates, with a random fallback for the odd image that has none.
 */
function deriveId(): string {
  for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (raw) return createHash("sha1").update(`em-gateway:${raw}`).digest("hex").slice(0, 16);
    } catch {
      // fall through
    }
  }
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

export function defaultConfig(): GatewayConfig {
  const id = deriveId();
  return {
    id,
    name: `Radio ${hostname()}`,
    serverUrl: process.env.GATEWAY_SERVER_URL?.trim() || "https://events-api.academyfirstaid.com/api",
    gatewayKey: "",
    eventId: null,
    ap: {
      ssid: `EM-Radio-${id.slice(0, 4).toUpperCase()}`,
      password: "12345687",
      countryCode: "BG",
      keepWithClient: false,
      onDemandMinutes: 30,
    },
    audio: { capture: "", playback: "", inputGain: 1, outputGain: 1 },
    squelch: {
      openLevel: 0.06,
      closeLevel: 0.035,
      hangMs: 900,
      minDurationMs: 400,
      maxDurationMs: 120_000,
    },
    ptt: {
      backend: "vox",
      gpioPin: 76,
      activeLow: true,
      leadMs: 350,
      tailMs: 250,
      maxTxMs: 90_000,
      waitForClearMs: 8_000,
    },
    ttsEnabled: false,
    storage: { maxMb: 2048, maxDays: 14 },
    consolePin: "",
  };
}

let cached: GatewayConfig | null = null;

export function loadConfig(): GatewayConfig {
  if (cached) return cached;
  mkdirSync(STATE_DIR, { recursive: true });
  const base = defaultConfig();
  if (existsSync(CONFIG_PATH)) {
    try {
      const stored = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<GatewayConfig>;
      // Merged one level deep so a new setting added by an update lands with
      // its default instead of undefined on every box already in the field.
      cached = {
        ...base,
        ...stored,
        ap: { ...base.ap, ...stored.ap },
        audio: { ...base.audio, ...stored.audio },
        squelch: clampSquelch({ ...base.squelch, ...stored.squelch }),
        ptt: { ...base.ptt, ...stored.ptt },
        storage: { ...base.storage, ...stored.storage },
        // The id is derived, never restored: a cloned SD card must not produce
        // two boxes claiming the same dashboard row.
        id: base.id,
      };
      return cached;
    } catch {
      // A corrupt file must not stop the box from booting into setup mode.
    }
  }
  cached = base;
  saveConfig(cached);
  return cached;
}

export function saveConfig(next: GatewayConfig): GatewayConfig {
  cached = next;
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

/**
 * Keep the squelch thresholds sane. The closing threshold must sit *below* the
 * opening one — that hysteresis is the whole point of having two. Set the other
 * way round the gate closes the moment it opens and chops speech to pieces, and
 * nothing in the console prevented an operator from dragging the sliders past
 * each other.
 */
function clampSquelch(squelch: GatewayConfig["squelch"]): GatewayConfig["squelch"] {
  const openLevel = Math.max(0.005, squelch.openLevel);
  return {
    ...squelch,
    openLevel,
    closeLevel: Math.min(squelch.closeLevel, openLevel * 0.85),
  };
}

/** Apply a partial patch, one level deep, and persist. */
export function patchConfig(patch: DeepPartial<GatewayConfig>): GatewayConfig {
  const current = loadConfig();
  const next: GatewayConfig = {
    ...current,
    ...(patch as Partial<GatewayConfig>),
    ap: { ...current.ap, ...patch.ap },
    audio: { ...current.audio, ...patch.audio },
    squelch: clampSquelch({ ...current.squelch, ...patch.squelch }),
    ptt: { ...current.ptt, ...patch.ptt },
    storage: { ...current.storage, ...patch.storage },
    id: current.id,
  };
  return saveConfig(next);
}

/** True once the box knows where the server is and how to authenticate. */
export function isProvisioned(config: GatewayConfig): boolean {
  return Boolean(config.serverUrl && config.gatewayKey);
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
