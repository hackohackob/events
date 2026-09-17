import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import type { SignalGeneration, SignalNetworkType, SignalSample } from "@events/contracts";

/**
 * Radio conditions attached to every medic location report, feeding the
 * dashboard's coverage survey.
 *
 * ── What this can and cannot measure ────────────────────────────────────────
 *
 * React Native exposes no signal-strength API on either platform. Android has
 * `TelephonyManager.getSignalStrength()` and iOS has nothing public at all, so
 * a true dBm reading needs a native module — and therefore a new binary, not an
 * OTA update. `SignalSample.rssi` exists for that day and stays undefined until
 * then. Nothing here pretends otherwise.
 *
 * What we CAN measure is the thing an operator actually asks about: "will a
 * medic standing here be able to reach me?" That is answered by combining
 *
 *   • the radio class the OS reports (5G/4G/3G/2G/Wi-Fi/none), which bounds the
 *     best case, with
 *   • whether traffic is really getting through, and how fast — observed from
 *     the location reports themselves, which are already going out on a cadence.
 *
 * A phone parked on "4G" that cannot complete a 2 KB POST has no usable signal,
 * and the survey says so. That is deliberately a *usability* score rather than
 * an antenna reading, and the contract documents it as such.
 */

/** Bars ceiling implied by the radio class alone — the best case, before any
 *  evidence of whether data is actually moving. */
const GENERATION_CEILING: Record<string, number> = {
  "5g": 4,
  "4g": 4,
  "3g": 2,
  "2g": 1,
};

/** Cellular of an unknown generation: assume serviceable but unremarkable. */
const UNKNOWN_CELLULAR_CEILING = 3;

/**
 * Wi-Fi with no strength reading (iOS never reports one). Wi-Fi at an event is
 * a base-station link or a hotspot — good, but not a claim about the ground,
 * so it does not get top marks.
 */
const WIFI_UNKNOWN_BARS = 3;

/**
 * Round-trip thresholds, ms. A report that takes longer than {@link RTT_BAD}
 * is a link a coordinator cannot rely on even though the phone says "connected".
 */
const RTT_GOOD = 600;
const RTT_FAIR = 1_500;
const RTT_BAD = 4_000;

/** Latency older than this says nothing about where the medic is standing now. */
const RTT_MAX_AGE_MS = 5 * 60_000;

/**
 * Smoothing on the round-trip estimate. One slow POST is a hiccup; a run of
 * them is a place. Weighted toward the newest sample so walking out of a dead
 * spot shows up within a couple of reports rather than a dozen.
 */
const RTT_SMOOTHING = 0.5;

/** Consecutive failed reports before we stop believing the OS's "connected". */
const FAILURES_BEFORE_DISTRUST = 2;

/**
 * Carrier names that carry no information. iOS 16 removed carrier lookup and
 * returns a literal "--"; Android can return a blank or a placeholder. Storing
 * these would put a junk row in the dashboard's carrier filter.
 */
const MEANINGLESS_CARRIERS = new Set(["--", "carrier", "unknown", "n/a", "none", ""]);

let latest: NetInfoState | null = null;
let smoothedRttMs: number | null = null;
let rttAt = 0;
let consecutiveFailures = 0;

// One subscription for the lifetime of the app. NetInfo multiplexes listeners
// over a single native observer, so this costs nothing beyond the callback and
// keeps `getSignalSample()` synchronous — it is called on the location hot path.
NetInfo.addEventListener((state) => {
  latest = state;
});
NetInfo.fetch()
  .then((state) => {
    latest = state;
  })
  .catch(() => undefined);

/**
 * Record the round-trip of a location report that reached the server.
 * This is the only direct evidence we get of real-world throughput.
 */
export function noteReportSuccess(roundTripMs: number): void {
  consecutiveFailures = 0;
  if (!Number.isFinite(roundTripMs) || roundTripMs < 0) return;
  const clamped = Math.min(roundTripMs, 120_000);
  smoothedRttMs =
    smoothedRttMs == null ? clamped : smoothedRttMs * (1 - RTT_SMOOTHING) + clamped * RTT_SMOOTHING;
  rttAt = Date.now();
}

/** Record a location report that never made it out. */
export function noteReportFailure(): void {
  consecutiveFailures += 1;
  // Don't leave a fast round-trip from a working spot standing as evidence for
  // a spot where nothing gets through.
  smoothedRttMs = null;
  rttAt = 0;
}

/** The round-trip estimate, if it is recent enough to mean anything. */
function currentRttMs(): number | undefined {
  if (smoothedRttMs == null) return undefined;
  if (Date.now() - rttAt > RTT_MAX_AGE_MS) return undefined;
  return Math.round(smoothedRttMs);
}

function normaliseCarrier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || MEANINGLESS_CARRIERS.has(trimmed.toLowerCase())) return undefined;
  return trimmed.slice(0, 40);
}

function networkTypeOf(state: NetInfoState): SignalNetworkType {
  switch (state.type) {
    case "cellular":
      return "cellular";
    case "wifi":
      return "wifi";
    case "ethernet":
      return "ethernet";
    case "none":
      return "none";
    default:
      return "unknown";
  }
}

function generationOf(state: NetInfoState): SignalGeneration {
  if (state.type === "cellular") {
    const gen = (state.details as { cellularGeneration?: string | null } | null)?.cellularGeneration;
    if (gen === "2g" || gen === "3g" || gen === "4g" || gen === "5g") return gen;
    return "unknown";
  }
  if (state.type === "wifi" || state.type === "ethernet") return "wifi";
  if (state.type === "none") return "none";
  return "unknown";
}

/** Best case the radio class allows, before any throughput evidence. */
function ceilingFor(state: NetInfoState): number {
  if (state.type === "none") return 0;
  if (state.type === "wifi" || state.type === "ethernet") {
    const strength = (state.details as { strength?: number | null } | null)?.strength;
    // Android reports Wi-Fi strength as a 0–100 percentage; iOS reports none.
    if (typeof strength === "number" && strength >= 0) {
      return Math.max(1, Math.round((strength / 100) * 4));
    }
    return WIFI_UNKNOWN_BARS;
  }
  if (state.type === "cellular") {
    const gen = generationOf(state);
    return GENERATION_CEILING[gen] ?? UNKNOWN_CELLULAR_CEILING;
  }
  return UNKNOWN_CELLULAR_CEILING;
}

/**
 * Current radio snapshot. Synchronous and allocation-light — this runs inside
 * `sendLocation`, which is on the battery-sensitive path.
 */
export function getSignalSample(): SignalSample {
  const state = latest;
  if (!state) {
    // Before the first NetInfo callback we genuinely do not know. Report the
    // absence rather than guessing: an "unknown" row is filtered out of the
    // survey, whereas a guessed 3 would be indistinguishable from a reading.
    return { networkType: "unknown", generation: "unknown" };
  }

  const networkType = networkTypeOf(state);
  const generation = generationOf(state);
  const carrier =
    state.type === "cellular"
      ? normaliseCarrier((state.details as { carrier?: string | null } | null)?.carrier)
      : undefined;

  const latencyMs = currentRttMs();
  let bars = ceilingFor(state);

  // Hard evidence beats the OS's optimism, in order of how conclusive it is.
  if (state.isConnected === false || state.type === "none") {
    bars = 0;
  } else if (state.isInternetReachable === false) {
    // Attached to a tower, but nothing is routing. For a coordinator trying to
    // reach this medic, that is the same as no signal.
    bars = 0;
  } else if (consecutiveFailures >= FAILURES_BEFORE_DISTRUST) {
    // Reports are failing while the OS still claims a connection — the classic
    // one-bar-at-the-edge-of-a-cell case. Not zero (something may still get
    // through), but never more than "very weak".
    bars = Math.min(bars, 1);
  } else if (latencyMs != null) {
    if (latencyMs >= RTT_BAD) bars = Math.min(bars, 1);
    else if (latencyMs >= RTT_FAIR) bars = Math.min(bars, 2);
    else if (latencyMs >= RTT_GOOD) bars = Math.min(bars, 3);
  }

  return {
    bars: Math.max(0, Math.min(4, bars)),
    networkType,
    generation,
    carrier,
    latencyMs,
  };
}

/** Diagnostics for the in-app Location screen. */
export function describeSignal(sample: SignalSample): string {
  const parts: string[] = [`${sample.bars ?? 0}/4`];
  if (sample.generation && sample.generation !== "unknown") parts.push(sample.generation.toUpperCase());
  if (sample.carrier) parts.push(sample.carrier);
  if (sample.latencyMs != null) parts.push(`${sample.latencyMs}ms`);
  return parts.join(" · ");
}
