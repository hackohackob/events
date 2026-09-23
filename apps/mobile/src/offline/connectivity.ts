import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { AppState, Platform } from "react-native";
import { API_BASE_URL } from "../ui/api-base";
import { debugLog } from "../debug/debug-log";
import { noteEnergyEvent } from "../debug/battery-diagnostics";
import { useSessionStore } from "../security/session-store";

/**
 * Single app-wide answer to "can traffic reach OUR server right now?".
 *
 * Every sender used to find out it was offline by firing a fetch and waiting
 * for it to fail — on a phone with zero coverage each attempt keeps the cell
 * radio in its high-power search state, which is what cooked the battery at
 * remote events. Senders consult `isOnline()` BEFORE touching the network and
 * queue immediately when it's false.
 *
 * ── Where the answer comes from ─────────────────────────────────────────────
 *
 * 1. The OS: attached to a network or not (NetInfo's native layer, free).
 * 2. Our own traffic: every apiFetch that gets ANY HTTP response proves the
 *    path works, every one that dies on the network proves it doesn't. The
 *    location reports go out on a cadence anyway, so in steady state this is
 *    the only evidence we need and nothing extra is ever sent.
 * 3. A probe to `GET /api/coverage/probe` — a bodiless 204 — sent ONLY when
 *    the two above leave a question open: right after the network changes,
 *    on return to the foreground after a quiet spell, and while we believe
 *    we're cut off (with backoff), to notice coverage coming back.
 *
 * This replaces NetInfo's built-in internet check, which on iOS fetched a
 * Google page every 60 s (every 5 s while failing) for as long as the app was
 * alive — all day, behind a locked screen. It is disabled below; Android never
 * ran it (it reads the OS's validated-network flag instead).
 *
 * Probe results also feed the coverage survey's latency evidence (see
 * signal-probe.ts), measured against the server that matters.
 *
 * Unknown counts as online, so a wrong or missing verdict can never block sends.
 */

// Must run before anything creates NetInfo's state: `configure` tears the state
// down and drops every listener already attached. This module is the only
// place in the app that talks to NetInfo directly, and index.js imports it
// first.
NetInfo.configure({ reachabilityShouldRun: () => false });

/** Probe request timeout. Long enough for a congested 3G link, short enough
 *  not to hold the radio in its high-power state. */
const PROBE_TIMEOUT_MS = 10_000;

/** Let the radio settle after a network change before probing. */
const PROBE_SETTLE_MS = 2_000;

/** Evidence younger than this answers a foreground check without a probe. */
const EVIDENCE_FRESH_MS = 2 * 60_000;

/** Retry spacing while cut off: 30 s, 1 min, 2 min, 4 min, then every 5 min.
 *  Any successful real request ends the backoff immediately. */
const RECOVERY_BASE_MS = 30_000;
const RECOVERY_MAX_MS = 5 * 60_000;

export type ProbeResult = { ok: true; rttMs: number } | { ok: false };

let attached = true; // OS says we're on a network (null from NetInfo = assume yes)
let networkKey = ""; // identity of the current network, to spot real changes
let reachable: boolean | null = null; // our server's verdict; null = unknown
let lastEvidenceAt = 0;
let failStreak = 0;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probeInFlight = false;
let lastNetState: NetInfoState | null = null;

const stateListeners = new Set<() => void>();
const probeListeners = new Set<(result: ProbeResult) => void>();

export function isOnline(): boolean {
  return attached && reachable !== false;
}

/** Our server verdict alone: true / false, or null while unknown. */
export function serverReachable(): boolean | null {
  return attached ? reachable : false;
}

/** Latest raw NetInfo state (radio class, carrier, …) for the coverage survey. */
export function latestNetState(): NetInfoState | null {
  return lastNetState;
}

/** Called whenever `isOnline()` may have changed. Returns an unsubscribe. */
export function subscribeConnectivity(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/** Called with every probe outcome — the survey's latency evidence. */
export function onProbeResult(listener: (result: ProbeResult) => void): () => void {
  probeListeners.add(listener);
  return () => probeListeners.delete(listener);
}

function setReachable(next: boolean | null): void {
  const before = isOnline();
  reachable = next;
  if (isOnline() !== before) {
    debugLog("api", isOnline() ? "info" : "warn", isOnline() ? "server reachable" : "server unreachable — sends parked");
    stateListeners.forEach((l) => l());
  }
}

function clearProbeTimer(): void {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
}

function scheduleProbe(delayMs: number): void {
  clearProbeTimer();
  probeTimer = setTimeout(() => {
    probeTimer = null;
    void probe();
  }, delayMs);
}

/**
 * Real traffic outcome. `true` = an HTTP response came back (any status: even a
 * 404 or a 500 proves the network path works — the server is a different
 * problem, and not one for the coverage map). `false` = the request died on the
 * network or timed out.
 */
export function noteServerReachable(ok: boolean): void {
  lastEvidenceAt = Date.now();
  if (ok) {
    failStreak = 0;
    clearProbeTimer();
    setReachable(true);
    return;
  }
  setReachable(false);
  failStreak += 1;
  // Watch for recovery. Don't stack a timer on top of one already pending —
  // a burst of failures must not keep pushing the retry further out.
  if (attached && !probeTimer && !probeInFlight) scheduleProbe(recoveryDelay());
}

function recoveryDelay(): number {
  return Math.min(RECOVERY_BASE_MS * 2 ** Math.max(0, failStreak - 1), RECOVERY_MAX_MS);
}

async function probe(): Promise<void> {
  if (probeInFlight || !attached) return;
  // Signed out (left the event): nothing sends, so nothing needs the answer —
  // stay asleep. Joining again makes a real request, which settles it.
  if (!useSessionStore.getState().token) return;
  probeInFlight = true;
  noteEnergyEvent("reachProbe");
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  let result: ProbeResult;
  try {
    await fetch(`${API_BASE_URL}/coverage/probe`, {
      method: "GET",
      cache: "no-store",
      headers: { "cache-control": "no-store" },
      signal: abort.signal,
    });
    result = { ok: true, rttMs: Date.now() - startedAt };
  } catch {
    result = { ok: false };
  } finally {
    clearTimeout(timeout);
    probeInFlight = false;
  }
  debugLog("api", result.ok ? "info" : "warn", result.ok ? `probe ok (${result.rttMs} ms)` : "probe failed");
  probeListeners.forEach((l) => l(result));
  noteServerReachable(result.ok);
}

function keyOf(state: NetInfoState): string {
  // Deliberately NOT the cellular generation: it flickers 4G↔3G every few
  // minutes on the move, and a probe per flicker is exactly the chatter this
  // module exists to remove. Android's native validated flag flipping IS a
  // useful hint that something changed upstream; iOS no longer has one.
  const validated = Platform.OS === "android" ? String(state.isInternetReachable) : "";
  return `${state.isConnected}|${state.type}|${validated}`;
}

function applyNetState(state: NetInfoState): void {
  lastNetState = state;
  const key = keyOf(state);
  if (key === networkKey) return;
  networkKey = key;

  const wasOnline = isOnline();
  attached = state.isConnected !== false && state.type !== "none";
  if (!attached) {
    // No network at all — nothing to probe until one appears.
    clearProbeTimer();
    failStreak = 0;
    reachable = false;
  } else {
    // A new network: whatever we knew about the old one is void. Unknown reads
    // as online, and one probe settles it.
    failStreak = 0;
    reachable = null;
    scheduleProbe(PROBE_SETTLE_MS);
  }
  if (isOnline() !== wasOnline) stateListeners.forEach((l) => l());
}

NetInfo.fetch()
  .then(applyNetState)
  .catch(() => undefined);
NetInfo.addEventListener(applyNetState);

// Back in the foreground after a quiet spell: the UI is about to show online /
// offline, so make sure it's current. One probe, and only if nothing has told
// us recently.
AppState.addEventListener("change", (next) => {
  if (next !== "active" || !attached) return;
  if (Date.now() - lastEvidenceAt < EVIDENCE_FRESH_MS) return;
  if (!probeTimer && !probeInFlight) scheduleProbe(0);
});
