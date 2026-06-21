import * as ExpoLocation from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Battery from "expo-battery";
import Constants from "expo-constants";
import { AppState, Linking, Platform } from "react-native";
import { apiFetch } from "../ui/api-client";
import { getSocket } from "../realtime/socket-client";
import { useSessionStore } from "../security/session-store";
import { OfflineQueue } from "../offline/offline-queue";
import { debugLog, describeError } from "../debug/debug-log";
import { useLocationStatus } from "../debug/location-status";
import { useSettingsStore } from "../settings/settings-store";
import { isBatteryOptimizationIgnored, requestDisableBatteryOptimization } from "./battery-optimization";

export const LOCATION_TASK_NAME = "background-location-task";

/** Background-task cadence while actively navigating — the screen may be locked
 *  but the dashboard still needs a near-live position + ETA. */
const NAV_MODE_INTERVAL_MS = 5_000;

const locationQueue = new OfflineQueue<Record<string, unknown>>();
let openedBackgroundLocationSettings = false;
let promptedBatteryExemption = false;

// ─── Background-task failure backoff ─────────────────────────────────────────
// On some Android builds expo-task-manager's TaskService loses its Context
// (it's held in a WeakReference that can be GC'd), after which every
// start/stopLocationUpdatesAsync rejects with a SharedPreferences.getAll() NPE
// — persistently, for the life of the process. Without a backoff the watchdog
// re-runs the full start every couple of minutes, and each run logs two more
// native NPEs (stop + start). We latch the failure and exponentially back off
// re-attempts so the log stays readable and we stop hammering a call that can't
// succeed, while still retrying occasionally in case a fresh Context recovers.
let bgTaskFailures = 0;
let bgTaskRetryAfter = 0; // epoch ms; don't re-attempt the background task before this
const BG_TASK_BACKOFF_BASE_MS = 60_000;
const BG_TASK_BACKOFF_MAX_MS = 15 * 60_000;

function noteBgTaskFailure(err: unknown): void {
  bgTaskFailures += 1;
  const backoff = Math.min(BG_TASK_BACKOFF_BASE_MS * 2 ** (bgTaskFailures - 1), BG_TASK_BACKOFF_MAX_MS);
  bgTaskRetryAfter = Date.now() + backoff;
  debugLog("location", "warn", "background location task failed to start (direct watch still active)", {
    error: describeError(err),
    consecutiveFailures: bgTaskFailures,
    nextRetryInSec: Math.round(backoff / 1000),
    impact:
      "JobScheduler/locked-screen delivery is degraded on this device — foreground tracking via the direct watch keeps working, but background fixes need the native TaskService fix (see patches/expo-task-manager).",
  });
}

function noteBgTaskSuccess(): void {
  if (bgTaskFailures > 0) debugLog("location", "info", "background location task recovered", { afterFailures: bgTaskFailures });
  bgTaskFailures = 0;
  bgTaskRetryAfter = 0;
}
/** True while turn-by-turn navigation is active — shortens the update interval. */
let navModeActive = false;

// ─── Accuracy gating ─────────────────────────────────────────────────────────
// Drop fixes that are too imprecise to be useful so the map/server never get a
// position that's off by hundreds of metres. BUT: never starve the server —
// indoors/on a charger every fix can be WiFi/cell-grade (>200m) for long
// stretches, and silently dropping all of them makes the medic vanish from the
// dashboard, which is far worse than an imprecise dot (the accuracy radius is
// shown anyway). If nothing has been sent for STALENESS_OVERRIDE_MS, the next
// fix goes through regardless of accuracy.
const MAX_ACCURACY_M = 200;
const RELATIVE_RECENCY_MS = 10 * 60_000;
const STALENESS_OVERRIDE_MS = 90_000;
let lastAcceptedAccuracy: number | null = null;
let lastAcceptedAt: number | null = null;

/** Returns a reason string if the fix should be dropped, otherwise null. */
function accuracyRejectReason(accuracy?: number): string | null {
  // Nothing sent for a while → send whatever we have, tagged with its accuracy.
  if (lastAcceptedAt != null && Date.now() - lastAcceptedAt > STALENESS_OVERRIDE_MS) return null;
  if (accuracy == null) return null; // no accuracy reported → can't judge, allow
  if (accuracy > MAX_ACCURACY_M) return `accuracy ${Math.round(accuracy)}m > ${MAX_ACCURACY_M}m`;
  // Much broader than a recent good fix → likely a bad sample; keep the good one.
  if (
    lastAcceptedAccuracy != null &&
    lastAcceptedAt != null &&
    Date.now() - lastAcceptedAt < RELATIVE_RECENCY_MS &&
    accuracy > lastAcceptedAccuracy * 2.5 &&
    accuracy > 60
  ) {
    return `accuracy ${Math.round(accuracy)}m ≫ last ${Math.round(lastAcceptedAccuracy)}m`;
  }
  return null;
}

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

/**
 * Send a single location fix to the server. Shared by the background task and
 * the one-shot send fired when the app launches. Records outcome to the debug
 * log and the location-status store so the Location tab can surface it.
 */
async function sendLocation(location: ExpoLocation.LocationObject): Promise<void> {
  const session = useSessionStore.getState();
  const isMedic = session.role === "medic" || session.role === "paramedic";

  // Gate on accuracy before doing anything — a too-broad fix is worse than none.
  const accuracy = location.coords.accuracy ?? undefined;
  const rejectReason = accuracyRejectReason(accuracy);
  if (rejectReason) {
    debugLog("location", "warn", "location dropped — too imprecise", rejectReason);
    useLocationStatus.getState().setReport({ at: Date.now(), ok: false, via: "skipped", error: rejectReason });
    return;
  }
  lastAcceptedAccuracy = accuracy ?? lastAcceptedAccuracy;
  lastAcceptedAt = Date.now();

  const battery = await readBatteryLevel();

  useLocationStatus.getState().setFix({
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    accuracy: location.coords.accuracy ?? undefined,
    battery,
    at: Date.now(),
  });

  if (isMedic) {
    const payload = {
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy: location.coords.accuracy ?? undefined,
      speed: location.coords.speed ?? undefined,
      heading: location.coords.heading ?? undefined,
      battery,
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
      debugLog("location", "info", "medic location sent via WS", { accuracy: payload.accuracy, battery });
      useLocationStatus.getState().setReport({ at: Date.now(), ok: true, via: "ws" });
      return;
    }

    const eventId = session.eventId ?? "";
    const medicId = session.userId ?? "";
    try {
      await apiFetch(`/events/${eventId}/medics/${medicId}/location`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      debugLog("location", "info", "medic location sent via HTTP", { accuracy: payload.accuracy, battery });
      useLocationStatus.getState().setReport({ at: Date.now(), ok: true, via: "http" });
    } catch (err) {
      locationQueue.enqueue("medic_location", { ...payload, eventId, medicId });
      debugLog("location", "error", "medic location send failed — queued", String(err));
      useLocationStatus.getState().setReport({ at: Date.now(), ok: false, via: "queue", error: String(err) });
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
  try {
    await apiFetch(`/events/${eventId}/location`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    debugLog("location", "info", "participant location sent", { accuracy: payload.accuracy, battery });
    useLocationStatus.getState().setReport({ at: Date.now(), ok: true, via: "http" });
  } catch (err) {
    locationQueue.enqueue("location.update", payload);
    debugLog("location", "error", "participant location send failed — queued", String(err));
    useLocationStatus.getState().setReport({ at: Date.now(), ok: false, via: "queue", error: String(err) });
  }
}

// Newest fix timestamp actually delivered to the server, and when we delivered
// it — used to collapse the post-Doze backlog flush into a single send and to
// dedupe the direct-watch path against the TaskManager fallback.
const STALE_FIX_MAX_AGE_MS = 30_000;
let lastDeliveredFixTimestamp = 0;
let lastDeliveredAt = 0;

// ─── Direct watch (primary background delivery) ──────────────────────────────

let directWatchSub: ExpoLocation.LocationSubscription | null = null;

async function startDirectWatch(isMedic: boolean, intervalMs: number): Promise<void> {
  directWatchSub?.remove();
  directWatchSub = null;
  try {
    directWatchSub = await ExpoLocation.watchPositionAsync(
      {
        accuracy: isMedic ? ExpoLocation.Accuracy.BestForNavigation : ExpoLocation.Accuracy.High,
        timeInterval: intervalMs,
        distanceInterval: 0,
      },
      (location) => {
        // Skip anything the task fallback (or a previous watch) already sent.
        if (location.timestamp <= lastDeliveredFixTimestamp) return;
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
    const location =
      (await ExpoLocation.getLastKnownPositionAsync()) ??
      (await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced }));
    if (location) {
      await sendLocation(location);
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
        const packageName = Constants.expoConfig?.android?.package ?? "com.a.atanasov.paramediceventapp";
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
    const configuredMs = useSettingsStore.getState().locationIntervalMs;
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
        await ExpoLocation.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          accuracy: isMedic ? ExpoLocation.Accuracy.BestForNavigation : ExpoLocation.Accuracy.High,
          timeInterval: intervalMs,
          distanceInterval: 0,
          deferredUpdatesInterval: 0,
          deferredUpdatesDistance: 0,
          mayShowUserSettingsDialog: true,
          foregroundService: {
            notificationTitle: "Medic Event App — live tracking",
            notificationBody: isMedic
              ? "Sharing your location with the event command centre"
              : "Sharing location with event coordinators",
            notificationColor: "#00C37A",
            killServiceOnDestroy: false,
          },
          showsBackgroundLocationIndicator: true,
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
    // when the background task above fails to register.
    await startDirectWatch(isMedic, intervalMs);
  } catch (err) {
    debugLog("location", "error", "background location updates failed to start", String(err));
    return false;
  }

  // 5. Fire an immediate one-shot send so the map shows a position right away.
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
    const running = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
    if (!running) return;
    debugLog("location", "info", `nav-mode tracking ${active ? "on" : "off"} — restarting updates`);
    await startLocationLoop();
  } catch (err) {
    debugLog("location", "error", "nav-mode tracking switch failed", String(err));
  }
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
  void sendLocation(location);
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
      if (!directWatchSub) await startDirectWatch(isMedicSession(), useSettingsStore.getState().locationIntervalMs);
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

export async function flushLocationQueue(): Promise<void> {
  const session = useSessionStore.getState();
  const ready = locationQueue.listReady();
  for (const item of ready) {
    try {
      // Medic items carry their own eventId — the session one may have changed
      // since the fix was queued.
      const eventId = (item.payload as any).eventId ?? session.eventId ?? "";
      const url = item.type === "medic_location"
        ? `/events/${eventId}/medics/${(item.payload as any).medicId}/location`
        : `/events/${eventId}/location`;
      await apiFetch(url, { method: "POST", body: JSON.stringify(item.payload) });
      locationQueue.remove(item.id);
    } catch {
      locationQueue.markFailed(item.id);
    }
  }
}
