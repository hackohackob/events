import * as ExpoLocation from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Battery from "expo-battery";
import Constants from "expo-constants";
import { AppState, Linking, Platform } from "react-native";
import { apiFetch } from "../ui/api-client";
import { getSocket } from "../realtime/socket-client";
import { useSessionStore } from "../security/session-store";
import { OfflineQueue } from "../offline/offline-queue";
import { isOnline } from "../offline/connectivity";
import { noteBatterySample, noteEnergyEvent, setLocationQueueSize } from "../debug/battery-diagnostics";
import { debugLog, describeError } from "../debug/debug-log";
import { useLocationStatus } from "../debug/location-status";
import { effectiveLocationIntervalMs, useSettingsStore } from "../settings/settings-store";
import { isBatteryOptimizationIgnored, requestDisableBatteryOptimization } from "./battery-optimization";

export const LOCATION_TASK_NAME = "background-location-task";

/** Background-task cadence while actively navigating — the screen may be locked
 *  but the dashboard still needs a near-live position + ETA. */
const NAV_MODE_INTERVAL_MS = 5_000;

// ─── iOS power shaping ───────────────────────────────────────────────────────
//
// iOS has no time-based location interval. CLLocationManager is driven by
// `desiredAccuracy` + `distanceFilter` alone — expo-location's iOS providers
// read exactly those two and never look at `timeInterval` (see
// ios/Providers/BaseLocationProvider.swift and ios/LocationOptions.swift).
//
// So "every 3 minutes" was never a power setting on iPhone: asking for
// BestForNavigation with distanceFilter 0 pins the GPS radio on at its highest
// power state permanently, and the JS send-gate below simply discarded the
// fixes it did not need. That throttled the network and the server, not the
// battery. These constants make the OS itself do the throttling.
//
// Android is unaffected: its interval genuinely works (LocationRequest sets
// both interval and minUpdateInterval), so it keeps reporting on time and keeps
// distanceInterval 0 so a stationary medic is never suppressed.

/** Metres of movement before iOS delivers another fix during normal tracking. */
const IOS_IDLE_DISTANCE_FILTER_M = 35;

/**
 * The accuracy tier the OS should be running at right now.
 *
 * `Balanced` is the one setting that genuinely powers the GPS down on Android:
 * it maps to PRIORITY_BALANCED_POWER_ACCURACY, which is served from wifi and
 * cell towers instead of the satellite radio (on iOS, kCLLocationAccuracy-
 * HundredMeters). It costs a fraction of `High` and gives roughly 100 m.
 *
 * That is the right trade for a medic holding a post and only the wrong one for
 * a medic on the move — which is why it is tied to the declared status rather
 * than guessed. The two ways a stationary medic starts moving both clear it on
 * their own: being dispatched sets the status to `going_to`, and starting
 * navigation sets navModeActive. Both restart tracking with a sharper tier.
 */
function effectiveAccuracy(): ExpoLocation.LocationAccuracy {
  if (navModeActive) return ExpoLocation.Accuracy.BestForNavigation;
  return useSettingsStore.getState().stationaryMode
    ? ExpoLocation.Accuracy.Balanced
    : ExpoLocation.Accuracy.High;
}

/** Speed that is unambiguously travel rather than GPS noise (≈7 km/h). */
const MOVING_SPEED_MPS = 2;

/**
 * Re-send the last known position on this cadence when the GPS has legitimately
 * gone quiet (iOS stationary + distance filter). Nothing is measured — it is the
 * cached fix with its original timestamp — so it costs a request and no radio
 * time, and it stops a medic holding a post from decaying to "offline" on
 * everyone else's map.
 */
const HEARTBEAT_CHECK_MS = 60_000;

const locationQueue = new OfflineQueue<Record<string, unknown>>();
let openedBackgroundLocationSettings = false;
let promptedBatteryExemption = false;

// ─── Background-task failure backoff ─────────────────────────────────────────
// Failures starting the background updates task fall in two classes and get
// very different treatment:
//
// PERMANENT — on some Android builds expo-task-manager's TaskService loses its
// Context (WeakReference GC'd), after which every start/stopLocationUpdatesAsync
// rejects with a SharedPreferences.getAll() NPE for the life of the process.
// Retrying only spams native crashes, so this class gets a long exponential
// backoff (1 min doubling to 15 min).
//
// TRANSIENT — everything else, most commonly Android 12+ refusing to start a
// location foreground service while the app isn't foregrounded (the join flow
// bounces through system settings for "Allow all the time", and the start often
// fires exactly in that window). These recover on a quick retry, so they get a
// short backoff plus a scheduled re-attempt — previously they were latched into
// the 15-minute backoff and the app looked like it "never registers tracking"
// until a full restart.
let bgTaskFailures = 0;
let bgTaskRetryAfter = 0; // epoch ms; don't re-attempt the background task before this
let bgTaskFailurePermanent = false; // true = known native NPE class
let bgTaskRetryTimer: ReturnType<typeof setTimeout> | null = null;
const BG_TASK_BACKOFF_BASE_MS = 60_000;
const BG_TASK_BACKOFF_MAX_MS = 15 * 60_000;
const BG_TASK_TRANSIENT_BASE_MS = 5_000;
const BG_TASK_TRANSIENT_MAX_MS = 60_000;

function noteBgTaskFailure(err: unknown): void {
  bgTaskFailures += 1;
  const error = describeError(err);
  bgTaskFailurePermanent = /NullPointerException|SharedPreferences/i.test(JSON.stringify(error) ?? String(err));
  const backoff = bgTaskFailurePermanent
    ? Math.min(BG_TASK_BACKOFF_BASE_MS * 2 ** (bgTaskFailures - 1), BG_TASK_BACKOFF_MAX_MS)
    : Math.min(BG_TASK_TRANSIENT_BASE_MS * 2 ** (bgTaskFailures - 1), BG_TASK_TRANSIENT_MAX_MS);
  bgTaskRetryAfter = Date.now() + backoff;
  debugLog("location", "warn", "background location task failed to start (direct watch still active)", {
    error,
    class: bgTaskFailurePermanent ? "permanent (native NPE)" : "transient",
    consecutiveFailures: bgTaskFailures,
    nextRetryInSec: Math.round(backoff / 1000),
  });
  // Transient failures self-heal: re-attempt shortly after the backoff expires
  // while the app is foregrounded, instead of waiting for the next watchdog
  // tick or app restart. One pending timer at a time.
  if (!bgTaskFailurePermanent && !bgTaskRetryTimer) {
    bgTaskRetryTimer = setTimeout(() => {
      bgTaskRetryTimer = null;
      if (AppState.currentState !== "active") return; // next foreground retries instead
      if (!useSessionStore.getState().token) return;
      debugLog("location", "info", "retrying background task start after transient failure");
      void startLocationLoop();
    }, backoff + 2_000);
  }
}

function noteBgTaskSuccess(): void {
  if (bgTaskFailures > 0) debugLog("location", "info", "background location task recovered", { afterFailures: bgTaskFailures });
  bgTaskFailures = 0;
  bgTaskRetryAfter = 0;
  bgTaskFailurePermanent = false;
}

/**
 * The app just returned to the foreground: any TRANSIENT start failure was
 * caused by conditions that no longer hold (foreground-service start is allowed
 * again), so drop the backoff — the caller's ensureTrackingAlive() can retry
 * immediately. The permanent NPE class keeps its long backoff; retrying it on
 * every foreground would just relog native crashes.
 */
export function resetTransientTrackingBackoff(): void {
  if (bgTaskFailurePermanent || bgTaskRetryAfter === 0) return;
  bgTaskFailures = 0;
  bgTaskRetryAfter = 0;
  lastWatchdogRestartAt = 0; // let the foreground watchdog pass restart immediately
}
/** True while turn-by-turn navigation is active — shortens the update interval. */
let navModeActive = false;

// ─── Send pacing ─────────────────────────────────────────────────────────────
// The configured interval CANNOT be trusted to reach the OS. expo-location
// persists the background task's options as JSON, and on every restart of the
// task it parses them back with `map["timeInterval"] as? Long` — but JSON hands
// back an Integer, and `Integer as? Long` is null in Kotlin, so `timeInterval`
// is silently dropped and the request falls back to the accuracy default
// (500 ms for BestForNavigation). Confirmed on a device: the fused provider was
// running at 500 ms–1 s while Settings said 60 s, and every delivery reported a
// position. `patches/expo-location+19.0.8.patch` fixes the parse, but only for
// builds that ship it — this throttle keeps the cadence honest regardless of
// what the OS decides to deliver, including on already-installed binaries.
let lastSendAt = 0;
/** GPS delivery jitter — a fix landing a hair early must not cost a full cycle. */
const SEND_SLACK_MS = 2_000;
/** Last battery reading, reused on throttled fixes so we don't re-poll at 2 Hz. */
let lastBatteryLevel: number | undefined;
/** Fix timestamp of the last report, so converging paths can't send it twice. */
let lastReportedFixTimestamp = 0;

// Fixes are delivered exactly as the OS reports them. An earlier version graded
// them on an accuracy ladder and dropped anything too vague, plus relative
// widening and teleport guards — but a dropped fix means the medic freezes on
// the dashboard, which is worse than an imprecise dot (the accuracy radius is
// drawn anyway, and MedicDot already flags anything over IMPRECISE_ACCURACY_M).
// Removed deliberately; do not reintroduce silent dropping here.

function isMedicSession(): boolean {
  const role = useSessionStore.getState().role;
  return role === "medic" || role === "paramedic";
}

async function readBatteryLevel(): Promise<number | undefined> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level >= 0 ? level : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the device is currently plugged in (charging or already full). */
async function readBatteryCharging(): Promise<boolean | undefined> {
  try {
    const state = await Battery.getBatteryStateAsync();
    if (state === Battery.BatteryState.UNKNOWN) return undefined;
    return state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
  } catch {
    return undefined;
  }
}

/**
 * Send a single location fix to the server. Shared by the background task and
 * the one-shot send fired when the app launches. Records outcome to the debug
 * log and the location-status store so the Location tab can surface it.
 */
async function sendLocation(
  location: ExpoLocation.LocationObject,
  opts: { force?: boolean; heartbeat?: boolean } = {},
): Promise<void> {
  const session = useSessionStore.getState();
  const isMedic = session.role === "medic" || session.role === "paramedic";

  // Never report the same fix twice. Opening the app fires two one-shots almost
  // together (the AppState listener and startLocationLoop's own), both "forced"
  // past the throttle, and both resolve to the same cached position — that is
  // the burst of three sends in one second seen in the log.
  //
  // The heartbeat is the deliberate exception: resending the SAME fix is the
  // whole point of it, so that a medic who has not moved still reads as present.
  if (!opts.heartbeat && location.timestamp === lastReportedFixTimestamp) return;

  // Pace the reports. Nav has its own cadence (sendNavLocationFix throttles to
  // NAV_FOREGROUND_SEND_INTERVAL_MS) and one-shots are explicit user/app intent,
  // so both bypass this. Everything below the gate is skipped on a throttled
  // fix — including the battery reads, which were running at the OS delivery
  // rate rather than ours.
  const sinceLastSend = Date.now() - lastSendAt;
  const minGapMs = effectiveLocationIntervalMs();
  if (!opts.force && !navModeActive && sinceLastSend < minGapMs - SEND_SLACK_MS) {
    // Keep the local position live even when we're not reporting it — the
    // locate button, nav progress and the debug screen all read this.
    useLocationStatus.getState().setFix({
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy: location.coords.accuracy ?? undefined,
      battery: lastBatteryLevel,
      at: Date.now(),
    });
    return;
  }

  // A medic who declared "holding a post" and is now clearly travelling is
  // being tracked coarse (Balanced) and slow (the stationary floor). Being
  // dispatched or starting navigation both clear the status on their own, so
  // this only catches someone who simply forgot — log it, because the symptom
  // (a lagging, ~100 m dot) is otherwise very hard to explain after the fact.
  const speed = location.coords.speed ?? 0;
  if (!navModeActive && speed > MOVING_SPEED_MPS && useSettingsStore.getState().stationaryMode) {
    debugLog("location", "warn", "moving while status is 'stationary' — tracking is coarse and slow", {
      speedMps: Math.round(speed * 10) / 10,
      hint: "switch status off 'On post' for full accuracy",
    });
  }

  // Count the attempt, not the success: if the network is down every fix would
  // otherwise sail through the gate and queue at the OS delivery rate.
  lastSendAt = Date.now();
  lastReportedFixTimestamp = location.timestamp;

  const battery = await readBatteryLevel();
  const charging = await readBatteryCharging();
  lastBatteryLevel = battery;
  noteBatterySample(battery);

  useLocationStatus.getState().setFix({
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    accuracy: location.coords.accuracy ?? undefined,
    battery,
    at: Date.now(),
  });

  // The fix above still feeds the local map — but with no event on the session
  // there is nowhere to REPORT it. Without this guard the id interpolated to ""
  // and every fix hit `/events//location`, which the server 404s; each failure
  // then landed in the retry queue and was replayed on every flush, so the log
  // filled with 404s that could never resolve.
  if (!session.eventId) {
    debugLog("location", "warn", "location not reported — no active event on the session");
    useLocationStatus.getState().setReport({ at: Date.now(), ok: false, via: "skipped", error: "no active event" });
    return;
  }

  if (isMedic) {
    const payload = {
      // Display name for the HTTP path — external guests aren't on the roster,
      // so without this the server can only fall back to the "external_…" id.
      name: session.name ?? undefined,
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy: location.coords.accuracy ?? undefined,
      speed: location.coords.speed ?? undefined,
      heading: location.coords.heading ?? undefined,
      battery,
      charging,
      // Real fix time — without it the server stamps arrival time, so a fix
      // flushed after a Doze freeze masquerades as a live position.
      timestamp: new Date(location.timestamp).toISOString(),
    };

    // WS only while the app is actually in the foreground. After the screen
    // locks, the socket can sit in a zombie state for minutes: `connected` is
    // still true (the ping timeout hasn't fired yet) but the TCP pipe is dead,
    // so emits are buffered into nothing and the fix is silently lost — the
    // medic vanishes from the dashboard even though every send "succeeded".
    // Background fixes always go over awaited HTTP, which surfaces failures
    // and falls into the retry queue.
    const socket = getSocket();
    if (AppState.currentState === "active" && socket.connected) {
      socket.emit("medic_location", payload);
      noteEnergyEvent("sendWs");
      debugLog("location", "info", "medic location sent via WS", { accuracy: payload.accuracy, battery });
      useLocationStatus.getState().setReport({ at: Date.now(), ok: true, via: "ws" });
      return;
    }

    const eventId = session.eventId ?? "";
    const medicId = session.userId ?? "";
    // Known offline → don't spin the radio up on a doomed fetch; park the fix
    // in the queue (newest-only) and let the connectivity listener flush it.
    if (!isOnline()) {
      queueLocation("medic_location", { ...payload, eventId, medicId }, "offline");
      return;
    }
    try {
      await apiFetch(`/events/${eventId}/medics/${medicId}/location`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      noteEnergyEvent("sendHttpOk");
      debugLog("location", "info", "medic location sent via HTTP", { accuracy: payload.accuracy, battery });
      useLocationStatus.getState().setReport({ at: Date.now(), ok: true, via: "http" });
    } catch (err) {
      noteEnergyEvent("sendHttpFail");
      queueLocation("medic_location", { ...payload, eventId, medicId }, String(err));
    }
    return;
  }

  // Participant / runner
  const eventId = session.eventId ?? "";
  const payload = {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    accuracy: location.coords.accuracy ?? undefined,
    battery,
    timestamp: new Date(location.timestamp).toISOString(),
  };
  if (!isOnline()) {
    queueLocation("location.update", payload, "offline");
    return;
  }
  try {
    await apiFetch(`/events/${eventId}/location`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    noteEnergyEvent("sendHttpOk");
    debugLog("location", "info", "participant location sent", { accuracy: payload.accuracy, battery });
    useLocationStatus.getState().setReport({ at: Date.now(), ok: true, via: "http" });
  } catch (err) {
    noteEnergyEvent("sendHttpFail");
    queueLocation("location.update", payload, String(err));
  }
}

/**
 * Park a fix in the offline queue, keeping ONLY the newest per type. A stale
 * position is worthless the moment a fresher one exists, and replaying an
 * hours-long backlog as a burst when coverage returns was both a server hammer
 * and a battery drain.
 */
function queueLocation(type: string, payload: Record<string, unknown>, reason: string): void {
  const offline = reason === "offline";
  if (offline) noteEnergyEvent("sendSkippedOffline");
  locationQueue.replaceLatest(type, payload);
  setLocationQueueSize(locationQueue.size);
  debugLog(
    "location",
    offline ? "info" : "error",
    offline ? "offline — location queued (newest kept)" : "location send failed — queued (newest kept)",
    reason,
  );
  useLocationStatus.getState().setReport({ at: Date.now(), ok: false, via: "queue", error: reason });
}

// Newest fix timestamp actually delivered to the server, and when we delivered
// it — used to collapse the post-Doze backlog flush into a single send and to
// dedupe the direct-watch path against the TaskManager fallback.
const STALE_FIX_MAX_AGE_MS = 30_000;
let lastDeliveredFixTimestamp = 0;
let lastDeliveredAt = 0;

// ─── Heartbeat ───────────────────────────────────────────────────────────────

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Re-send the last known position when the GPS has been legitimately quiet for
 * longer than the reporting interval.
 *
 * Letting iOS park the radio while a medic stands still is most of the battery
 * win, but it has a cost: a medic holding a post produces no fixes, so their
 * marker ages out and the rest of the team reads them as offline. This resends
 * what we already have — no measurement, no radio — carrying the ORIGINAL fix
 * timestamp, so the server records an honest "position from 6 minutes ago, medic
 * still with us" rather than pretending it is fresh.
 */
function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    // Navigation reports continuously; nothing to prop up.
    if (navModeActive) return;
    const session = useSessionStore.getState();
    if (!session.eventId) return;
    const fix = useLocationStatus.getState().lastFix;
    if (!fix) return;

    const quietFor = Date.now() - lastSendAt;
    if (quietFor < effectiveLocationIntervalMs() + SEND_SLACK_MS) return;
    if (!isOnline()) return;

    noteEnergyEvent("heartbeat");
    void sendLocation(
      {
        coords: {
          latitude: fix.lat,
          longitude: fix.lng,
          accuracy: fix.accuracy ?? null,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        // The real age of the position, not now — the server and every
        // freshness dot downstream depend on this being truthful.
        timestamp: fix.at,
      } as ExpoLocation.LocationObject,
      { force: true, heartbeat: true },
    );
  }, HEARTBEAT_CHECK_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

// ─── Direct watch (primary background delivery) ──────────────────────────────

let directWatchSub: ExpoLocation.LocationSubscription | null = null;

async function startDirectWatch(intervalMs: number): Promise<void> {
  directWatchSub?.remove();
  directWatchSub = null;
  try {
    directWatchSub = await ExpoLocation.watchPositionAsync(
      {
        // High is nearestTenMeters on iOS and the same PRIORITY_HIGH_ACCURACY
        // bucket as BestForNavigation on Android — so this costs Android
        // nothing and takes iOS off its most expensive setting. Ten metres is
        // far finer than anyone needs to find a colleague on a map; the extra
        // power went to the last few metres nobody reads. Drops to Balanced
        // while holding a post — see effectiveAccuracy.
        accuracy: effectiveAccuracy(),
        timeInterval: intervalMs,
        // Android paces itself by time, so a distance gate there would only
        // silence a stationary medic. iOS has nothing BUT this gate.
        distanceInterval: Platform.OS === "ios" ? IOS_IDLE_DISTANCE_FILTER_M : 0,
      },
      (location) => {
        noteEnergyEvent("gpsFix");
        // Skip anything the task fallback (or a previous watch) already sent.
        if (location.timestamp <= lastDeliveredFixTimestamp) return;
        // Skip a stale OS-cached fix delivered on unlock (the position from when
        // the screen locked) — a current fix follows within the watch interval.
        if (Date.now() - location.timestamp > 25_000) return;
        lastDeliveredFixTimestamp = location.timestamp;
        lastDeliveredAt = Date.now();
        void sendLocation(location);
      },
    );
    debugLog("location", "info", "direct location watch started", { intervalMs });
  } catch (err) {
    debugLog("location", "error", "direct location watch failed to start", describeError(err));
  }
}

// ─── Background task definition ──────────────────────────────────────────────
// Must be defined at module level (before registerRootComponent) so the native
// side can wake the JS runtime and find the task handler.

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: any) => {
  if (error) {
    console.warn("[LocationTask] error:", error.message);
    debugLog("location", "error", "background task error", error.message);
    return;
  }

  const locations: ExpoLocation.LocationObject[] = data?.locations ?? [];
  if (!locations.length) return;
  noteEnergyEvent("gpsFix");

  const location = locations[locations.length - 1]!;
  const session = useSessionStore.getState();
  if (session.role !== "medic" && session.role !== "paramedic" && !session.eventId) return;

  // Doze flush guard. When the device dozes, the OS freezes the JS runtime but
  // keeps queueing task invocations; on wake they all execute back-to-back and
  // 20+ minutes of stale fixes blast the server in one second. Each invocation
  // here sees one slice of that backlog: skip slices that are older than what
  // we've already delivered, and skip stale slices when something fresh was
  // delivered moments ago — but always let one through after a silence so the
  // server gets the newest known position even if it's old (with its real
  // timestamp attached, see sendLocation).
  if (location.timestamp <= lastDeliveredFixTimestamp) {
    debugLog("location", "info", "skipped already-superseded queued fix");
    return;
  }
  const fixAgeMs = Date.now() - location.timestamp;
  if (fixAgeMs > STALE_FIX_MAX_AGE_MS && Date.now() - lastDeliveredAt < STALE_FIX_MAX_AGE_MS) {
    debugLog("location", "info", `skipped stale queued fix (${Math.round(fixAgeMs / 1000)}s old)`);
    return;
  }
  lastDeliveredFixTimestamp = location.timestamp;
  lastDeliveredAt = Date.now();

  // Drain any fixes that failed to send on earlier wakes first (oldest →
  // newest), THEN send the current one — so a retried stale position can never
  // overwrite the fresh one on the server.
  await flushLocationQueue();
  await sendLocation(location);
});

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Capture a fix immediately and send it. The background updates task is
 * interval/distance-gated, so on a fresh launch nothing is reported until the
 * device moves — this guarantees an immediate position on app open.
 */
export async function sendCurrentLocationNow(): Promise<void> {
  try {
    const permission = await ExpoLocation.getForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      debugLog("location", "warn", "one-shot send skipped — no foreground permission");
      return;
    }
    // Prefer the OS-cached fix only when it's actually fresh. On unlock the
    // last-known position is the one captured when the screen locked (possibly
    // far behind, after travelling locked), so sending it teleports the medic to
    // the lock spot before the real position arrives. If the cache is stale, get
    // a current fix instead.
    const FRESH_ENOUGH_MS = 20_000;
    const lastKnown = await ExpoLocation.getLastKnownPositionAsync();
    const fresh = lastKnown && Date.now() - lastKnown.timestamp <= FRESH_ENOUGH_MS;
    const location = fresh
      ? lastKnown
      : await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced });
    if (location) {
      // Explicit intent (app opened, tracking (re)started, debug button) —
      // always report, never wait out the interval.
      await sendLocation(location, { force: true });
    }
  } catch (err) {
    debugLog("location", "error", "one-shot send failed", String(err));
  }
}

export async function requestAlwaysLocationPermission(): Promise<boolean> {
  const { status: fgStatus } = await ExpoLocation.requestForegroundPermissionsAsync();
  if (fgStatus !== "granted") {
    debugLog("location", "error", "foreground location permission denied");
    return false;
  }

  const { status: bgStatus } = await ExpoLocation.requestBackgroundPermissionsAsync();
  if (bgStatus === "granted") return true;

  debugLog("location", "warn", "background location permission not granted", { status: bgStatus });
  if (Platform.OS === "android" && !openedBackgroundLocationSettings) {
    openedBackgroundLocationSettings = true;
    debugLog("location", "info", "opening app settings for Allow all the time location permission");
    await Linking.openSettings();
  }
  return false;
}

export async function startLocationLoop(): Promise<boolean> {
  const session = useSessionStore.getState();
  const isMedic = session.role === "medic" || session.role === "paramedic";

  if (!(await requestAlwaysLocationPermission())) return false;

  // Without a Doze exemption Android throttles the foreground service's network
  // (and often its GPS) once the screen locks, so updates arrive minutes apart
  // or not at all. Show the one-tap "Allow" prompt once per app run.
  if (Platform.OS === "android") {
    // Surface the exemption state on every (re)start — when background sends go
    // silent, this is the first thing to check in the debug log.
    const exempt = await isBatteryOptimizationIgnored().catch(() => false);
    debugLog("location", exempt ? "info" : "warn", `battery optimization exemption: ${exempt ? "granted" : "NOT granted — background tracking will freeze in Doze"}`);
  }
  if (Platform.OS === "android" && !promptedBatteryExemption) {
    promptedBatteryExemption = true;
    try {
      if (!(await isBatteryOptimizationIgnored())) {
        const packageName = Constants.expoConfig?.android?.package ?? "com.academyfirstaid.extrememedics";
        debugLog("location", "info", "requesting battery optimization exemption");
        await requestDisableBatteryOptimization(packageName);
      }
    } catch (err) {
      debugLog("location", "warn", "battery exemption prompt failed", String(err));
    }
  }

  try {
    // 3. Stop any previously running task before (re)starting.
    //
    // On Android, stopLocationUpdatesAsync can throw a NullPointerException
    // (SharedPreferences.getAll() on null) when TaskManager reports the task as
    // registered but expo-location's own prefs store hasn't hydrated yet — the
    // typical case being a cold start where JobScheduler revives the task before
    // the location module initializes. This stop is pure cleanup, so swallow the
    // failure and fall through to startLocationUpdatesAsync, which re-registers
    // the task with a fresh config anyway.
    // While the background task is in its failure backoff, skip the pre-stop
    // too: it hits the same native NPE and only adds noise. We'll re-attempt the
    // whole start/stop dance once the backoff window elapses.
    const attemptBgTask = Date.now() >= bgTaskRetryAfter;
    const running = attemptBgTask && (await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME));
    if (running) {
      try {
        await ExpoLocation.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      } catch (stopErr) {
        debugLog("location", "warn", "stopLocationUpdatesAsync failed during restart (ignored)", describeError(stopErr));
      }
    }

    // 4. Start continuous background updates.
    //
    // On Android this drives FusedLocationProviderClient. BestForNavigation /
    // High map to Priority.PRIORITY_HIGH_ACCURACY, which keeps the GPS radio
    // active instead of degrading to ~1km cell/wifi fixes when the screen is
    // off. The interval comes from Settings; deferredUpdates* = 0 disables
    // location batching so every fix is delivered immediately rather than
    // buffered and flushed later. distanceInterval 0 avoids suppressing
    // stationary users.
    //
    // The foregroundService block is NOT optional: expo-location only keeps
    // delivering updates after the app is backgrounded/swiped away through its
    // own sticky foreground service. (A notifee-owned foreground service was
    // tried instead to get action buttons on the notification — tracking died
    // the moment the app left the foreground.)
    const configuredMs = effectiveLocationIntervalMs();
    const intervalMs = navModeActive ? Math.min(NAV_MODE_INTERVAL_MS, configuredMs) : configuredMs;

    // The background task start can throw a native NullPointerException on some
    // Android devices (expo-location reading a null SharedPreferences). That
    // must NOT abort tracking: the direct watch below is the PRIMARY delivery
    // path and works independently of the JobScheduler-backed task. So isolate
    // the background start in its own try/catch and always fall through to
    // startDirectWatch.
    if (!attemptBgTask) {
      // Still inside the backoff window from an earlier persistent failure.
      debugLog("location", "info", "background task start skipped — backing off", {
        consecutiveFailures: bgTaskFailures,
        retryInSec: Math.max(0, Math.round((bgTaskRetryAfter - Date.now()) / 1000)),
      });
    } else {
      try {
        const ios = Platform.OS === "ios";
        await ExpoLocation.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          // Navigation asks for the best fix money can buy, holding a post asks
          // for the cheapest that still finds someone, everything else sits in
          // between. See effectiveAccuracy.
          accuracy: effectiveAccuracy(),
          timeInterval: intervalMs,
          // iOS has no time gate, so this is the only one it gets. Android keeps
          // 0 — its interval already paces it and a distance gate there would
          // only silence a medic holding a post.
          distanceInterval: ios && !navModeActive ? IOS_IDLE_DISTANCE_FILTER_M : 0,
          // iOS honours these two in the task consumer (EXLocationTaskConsumer)
          // and they are what batches delivery to our configured cadence instead
          // of waking the JS runtime for every fix the GPS produces. Android
          // keeps 0 — its own interval already paces it and deferring would just
          // add latency.
          deferredUpdatesInterval: ios && !navModeActive ? intervalMs : 0,
          deferredUpdatesDistance: 0,
          // Tells iOS what kind of movement to expect so it can shut the radio
          // down sensibly between fixes. Only the task path reads it.
          activityType: navModeActive
            ? ExpoLocation.ActivityType.OtherNavigation
            : ExpoLocation.ActivityType.Fitness,
          mayShowUserSettingsDialog: true,
          foregroundService: {
            notificationTitle: "Extreme Medics — live tracking",
            notificationBody: isMedic
              ? "Sharing your location with the event command centre"
              : "Sharing location with event coordinators",
            notificationColor: "#00C37A",
            killServiceOnDestroy: false,
          },
          showsBackgroundLocationIndicator: true,
          // Deliberately left OFF, even though it is the single biggest iOS
          // battery lever available.
          //
          // When iOS pauses updates it does not resume on its own: expo-location
          // does not implement locationManagerDidPauseLocationUpdates, so the
          // only wake-up is significant-change monitoring, which needs roughly a
          // cell-tower's worth of movement. A medic who walks 150 m from their
          // post would keep reporting the post — and the heartbeat would keep
          // insisting they are online there. A silently wrong position is far
          // worse than a flat battery, so this stays false until we can drive
          // the resume ourselves.
          pausesUpdatesAutomatically: false,
        });

        const registered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
        if (registered) {
          noteBgTaskSuccess();
          debugLog("location", "info", "background location updates started", { isMedic });
        } else {
          debugLog("location", "warn", "background task did not register — relying on direct watch");
        }
      } catch (bgErr) {
        // Known expo-task-manager Android NPE (TaskService lost its Context) —
        // degrade to direct-watch-only instead of failing the whole start.
        // Locked-screen delivery via the task is lost, but the foreground
        // service + direct watch keep live tracking working. Latch + back off.
        noteBgTaskFailure(bgErr);
      }
    }

    // Primary delivery path: a plain watch subscription (direct callback, no
    // JobScheduler) kept alive by the foreground service. Always started, even
    // when the background task above fails to register — EXCEPT while
    // navigating: the nav camera hook runs its own 1s foreground watcher whose
    // fixes are already sent (throttled) via sendNavLocationFix, so a second
    // concurrent GPS subscription would only double the sends and the drain.
    if (navModeActive) {
      directWatchSub?.remove();
      directWatchSub = null;
      debugLog("location", "info", "direct watch skipped — nav watcher owns foreground delivery");
    } else {
      await startDirectWatch(intervalMs);
    }
  } catch (err) {
    debugLog("location", "error", "background location updates failed to start", String(err));
    return false;
  }

  // 5. Keep a medic who is standing still on everyone's map. Only matters once
  //    the OS is allowed to stop producing fixes, but it is harmless otherwise —
  //    it only fires after a full interval of silence.
  startHeartbeat();

  // 6. Fire an immediate one-shot send so the map shows a position right away.
  void sendCurrentLocationNow();
  return true;
}

/**
 * Switch the background task between the configured cadence and the fast
 * navigation cadence. Restarting the updates task applies the new interval;
 * a no-op when the mode hasn't changed or tracking isn't running.
 */
export async function setNavModeTracking(active: boolean): Promise<void> {
  if (navModeActive === active) return;
  navModeActive = active;
  try {
    if (active) {
      // The nav camera hook's 1s watcher takes over foreground delivery — drop
      // the regular direct watch so only one GPS subscription feeds sends.
      directWatchSub?.remove();
      directWatchSub = null;
    }
    const running = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(() => false);
    if (!running) {
      // No background task (e.g. the known Android NPE) — just restore the
      // direct watch when navigation ends; nothing else to restart.
      if (!active && useSessionStore.getState().token) {
        await startDirectWatch(effectiveLocationIntervalMs());
      }
      return;
    }
    debugLog("location", "info", `nav-mode tracking ${active ? "on" : "off"} — restarting updates`);
    await startLocationLoop();
  } catch (err) {
    debugLog("location", "error", "nav-mode tracking switch failed", String(err));
  }
}

/**
 * Re-apply the tracking cadence after something changed it (status → stationary,
 * or the interval picker in Settings). A no-op without a session.
 */
export async function refreshTrackingInterval(): Promise<void> {
  if (!useSessionStore.getState().token) return;
  debugLog("location", "info", "re-applying tracking cadence", { intervalMs: effectiveLocationIntervalMs() });
  await startLocationLoop();
}

let lastNavSendAt = 0;
const NAV_FOREGROUND_SEND_INTERVAL_MS = 5_000;

/**
 * Server send for the high-frequency foreground navigation watcher. The watcher
 * fires every second to drive the puck/camera; reporting every fix would flood
 * the server, so sends are throttled to one every few seconds.
 */
export function sendNavLocationFix(location: ExpoLocation.LocationObject): void {
  if (Date.now() - lastNavSendAt < NAV_FOREGROUND_SEND_INTERVAL_MS) return;
  lastNavSendAt = Date.now();
  // Stamp the shared dedupe marker so the background task (still running at
  // its own cadence) skips fixes the nav watcher already delivered.
  if (location.timestamp > lastDeliveredFixTimestamp) {
    lastDeliveredFixTimestamp = location.timestamp;
    lastDeliveredAt = Date.now();
  }
  // Already throttled to NAV_FOREGROUND_SEND_INTERVAL_MS just above, and nav
  // deliberately reports faster than the configured interval.
  void sendLocation(location, { force: true });
}

let lastWatchdogRestartAt = 0;
const WATCHDOG_RESTART_COOLDOWN_MS = 120_000;

/**
 * Watchdog: verify the background updates task is still registered, and restart
 * it if the OS killed it. Safe to call often — a no-op when healthy.
 *
 * NOTE: it intentionally does NOT consult hasStartedLocationUpdatesAsync(): in
 * this expo-location version that call frequently returns false even while
 * updates are streaming, which sent the watchdog into a restart loop. Task
 * registration is the reliable signal, backed by a cooldown so a genuinely
 * dead service is only re-kicked at most once every couple of minutes.
 */
export async function ensureTrackingAlive(): Promise<void> {
  try {
    const session = useSessionStore.getState();
    if (!session.token) return;
    const permission = await ExpoLocation.getForegroundPermissionsAsync();
    if (permission.status !== "granted") return;

    const registered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
    if (registered) return;

    // If the background task is in its failure backoff, a restart would just hit
    // the same native NPE — let the backoff window govern re-attempts instead of
    // the 2-minute watchdog cooldown, and keep the direct watch alive meanwhile.
    if (Date.now() < bgTaskRetryAfter) {
      if (!directWatchSub && !navModeActive) {
        await startDirectWatch(effectiveLocationIntervalMs());
      }
      return;
    }

    if (Date.now() - lastWatchdogRestartAt < WATCHDOG_RESTART_COOLDOWN_MS) return;
    lastWatchdogRestartAt = Date.now();
    debugLog("location", "warn", "tracking watchdog: task not registered — restarting");
    await startLocationLoop();
  } catch (err) {
    debugLog("location", "error", "tracking watchdog failed", describeError(err));
  }
}

export async function stopLocationLoop(): Promise<void> {
  stopHeartbeat();
  directWatchSub?.remove();
  directWatchSub = null;
  const running = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (running) {
    try {
      await ExpoLocation.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      debugLog("location", "info", "background location updates stopped");
    } catch (err) {
      // Same Android NPE as in the restart path — see startLocationLoop. The
      // direct watch is already removed above, so tracking is effectively off
      // regardless of whether the native task tears down cleanly.
      debugLog("location", "warn", "stopLocationUpdatesAsync failed (ignored)", describeError(err));
    }
  }
}

let flushInFlight = false;

export async function flushLocationQueue(): Promise<void> {
  // Multiple triggers can coincide (NetInfo flip + app foreground + background
  // task) — one pass at a time, and never while known-offline.
  if (flushInFlight || !isOnline() || locationQueue.size === 0) return;
  flushInFlight = true;
  noteEnergyEvent("queueFlush");
  try {
    const session = useSessionStore.getState();
    const ready = locationQueue.listReady();
    for (const item of ready) {
      try {
        // Medic items carry their own eventId — the session one may have changed
        // since the fix was queued.
        const eventId = (item.payload as any).eventId ?? session.eventId ?? "";
        const medicId = (item.payload as any).medicId ?? "";
        // Drop what can never be delivered. Fixes queued before this guard
        // existed (or after the event was cleared) carry no event id, and
        // retrying them just replays a guaranteed 404 on every flush.
        if (!eventId || (item.type === "medic_location" && !medicId)) {
          locationQueue.remove(item.id);
          debugLog("location", "warn", "queued fix dropped — no event id to send it to");
          continue;
        }
        const url = item.type === "medic_location"
          ? `/events/${eventId}/medics/${medicId}/location`
          : `/events/${eventId}/location`;
        await apiFetch(url, { method: "POST", body: JSON.stringify(item.payload) });
        locationQueue.remove(item.id);
      } catch {
        locationQueue.markFailed(item.id);
      }
    }
  } finally {
    flushInFlight = false;
    setLocationQueueSize(locationQueue.size);
  }
}
