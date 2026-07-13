import { create } from "zustand";
import { debugLog } from "./debug-log";

/**
 * Per-feature energy accounting. Counts the events that actually cost battery
 * (GPS fixes processed, radio touches, reconnect storms) plus a rolling window
 * of battery-level samples, so the Location diagnostics tab can show WHICH
 * feature is burning power and at what rate — and the debug log gets a
 * periodic drain snapshot to correlate against.
 */
export type EnergyEventKind =
  | "gpsFix" // a GPS fix delivered to JS (any watcher)
  | "sendWs" // location sent over the live socket
  | "sendHttpOk" // location POST succeeded
  | "sendHttpFail" // location POST failed (network/API error)
  | "sendSkippedOffline" // send short-circuited by the connectivity gate (no radio touched)
  | "queueFlush" // a flush pass over the offline location queue
  | "socketConnectError" // socket.io reconnect attempt failed
  | "apiNetworkError"; // any apiFetch that died on the network

export const ENERGY_EVENT_LABELS: Record<EnergyEventKind, string> = {
  gpsFix: "GPS fixes",
  sendWs: "Sends via socket",
  sendHttpOk: "Sends via HTTP ✓",
  sendHttpFail: "Sends via HTTP ✗",
  sendSkippedOffline: "Sends skipped (offline)",
  queueFlush: "Queue flush passes",
  socketConnectError: "Socket connect errors",
  apiNetworkError: "API network errors",
};

interface BatterySample {
  at: number; // epoch ms
  level: number; // 0–1
}

interface EnergyEvent {
  at: number;
  kind: EnergyEventKind;
}

/** Rolling window used for the "per 10 min" rates in the diagnostics UI. */
export const ENERGY_RATE_WINDOW_MS = 10 * 60_000;
const MAX_EVENTS = 600;
const MAX_BATTERY_SAMPLES = 240;
const DRAIN_LOG_EVERY_MS = 10 * 60_000;

interface BatteryDiagnosticsState {
  /** Lifetime (per app run) totals per event kind. */
  totals: Record<EnergyEventKind, number>;
  /** Recent events, newest last — trimmed to MAX_EVENTS. */
  events: EnergyEvent[];
  batterySamples: BatterySample[];
  locationQueueSize: number;
}

const emptyTotals = (): Record<EnergyEventKind, number> => ({
  gpsFix: 0,
  sendWs: 0,
  sendHttpOk: 0,
  sendHttpFail: 0,
  sendSkippedOffline: 0,
  queueFlush: 0,
  socketConnectError: 0,
  apiNetworkError: 0,
});

export const useBatteryDiagnostics = create<BatteryDiagnosticsState>(() => ({
  totals: emptyTotals(),
  events: [],
  batterySamples: [],
  locationQueueSize: 0,
}));

/** Record one energy-relevant event. Never throws; safe from the background task. */
export function noteEnergyEvent(kind: EnergyEventKind): void {
  try {
    const state = useBatteryDiagnostics.getState();
    const events = [...state.events, { at: Date.now(), kind }];
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    useBatteryDiagnostics.setState({
      totals: { ...state.totals, [kind]: state.totals[kind] + 1 },
      events,
    });
  } catch {
    // diagnostics must never break the feature being measured
  }
}

export function setLocationQueueSize(locationQueueSize: number): void {
  try {
    if (useBatteryDiagnostics.getState().locationQueueSize !== locationQueueSize) {
      useBatteryDiagnostics.setState({ locationQueueSize });
    }
  } catch {
    // ignore
  }
}

let lastDrainLogAt = 0;

/** Record a battery level sample (0–1); periodically logs a drain snapshot. */
export function noteBatterySample(level: number | undefined): void {
  if (level == null || level < 0) return;
  try {
    const state = useBatteryDiagnostics.getState();
    const batterySamples = [...state.batterySamples, { at: Date.now(), level }];
    if (batterySamples.length > MAX_BATTERY_SAMPLES) {
      batterySamples.splice(0, batterySamples.length - MAX_BATTERY_SAMPLES);
    }
    useBatteryDiagnostics.setState({ batterySamples });

    if (Date.now() - lastDrainLogAt >= DRAIN_LOG_EVERY_MS && batterySamples.length >= 2) {
      lastDrainLogAt = Date.now();
      const drain = drainPercentPerHour(batterySamples);
      debugLog("location", "info", "battery drain snapshot", {
        batteryPct: Math.round(level * 100),
        drainPctPerHour: drain == null ? "n/a" : Math.round(drain * 10) / 10,
        last10min: rateSummary(state.events),
        queuedLocationFixes: state.locationQueueSize,
      });
    }
  } catch {
    // ignore
  }
}

/**
 * Battery drop rate over the sample window, in %/hour. Positive = draining.
 * Null while the window is too short to be meaningful, or when charging.
 */
export function drainPercentPerHour(samples: BatterySample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const hours = (last.at - first.at) / 3_600_000;
  if (hours < 0.05) return null; // < 3 minutes of data
  const dropPct = (first.level - last.level) * 100;
  if (dropPct < 0) return null; // charging
  return dropPct / hours;
}

/** Counts per event kind inside the rate window — the UI's "last 10 min" column. */
export function countsInWindow(events: EnergyEvent[], now = Date.now()): Record<EnergyEventKind, number> {
  const out = emptyTotals();
  for (const event of events) {
    if (now - event.at <= ENERGY_RATE_WINDOW_MS) out[event.kind] += 1;
  }
  return out;
}

function rateSummary(events: EnergyEvent[]): Record<string, number> {
  const counts = countsInWindow(events);
  const out: Record<string, number> = {};
  for (const [kind, count] of Object.entries(counts)) {
    if (count > 0) out[kind] = count;
  }
  return out;
}
