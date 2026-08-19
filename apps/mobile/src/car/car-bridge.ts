/**
 * Orchestrates the Android Auto projection from the JS side.
 *
 * Responsibilities, in order of importance:
 *
 *  1. Cost nothing when the car is not there. Every subscription, timer and
 *     serialization below is created on connect and torn down on disconnect —
 *     a phone in a pocket must not pay for a screen nobody is looking at.
 *  2. Mirror the stores into the native car app (see `car-types.ts`).
 *  3. Run car-initiated actions through the SAME store functions the phone UI
 *     calls, never a parallel implementation.
 *
 * Nothing here touches audio: nav voice, the incident siren and the chat chime
 * keep playing exactly where they play today.
 */
import type { EmitterSubscription } from "react-native";
import { DEFAULT_VEHICLE_TYPE } from "@events/contracts";
import { useSessionStore } from "../security/session-store";
import { useSettingsStore } from "../settings/settings-store";
import { useRosterStore } from "../security/roster-store";
import { useMapStore } from "../map/map-store";
import { useZonesStore } from "../map/zones/zones-store";
import { useZoneVisibilityStore } from "../map/zones/zone-visibility-store";
import { useNavStore } from "../navigation/nav-store";
import { useTrackNavStore } from "../tracknav/track-nav-store";
import { useLocationStatus } from "../debug/location-status";
import { useBatteryDiagnostics } from "../debug/battery-diagnostics";
import { useBuildInfo } from "../debug/build-info";
import { VEHICLE_DEFAULT_PROFILE } from "../navigation/surface";
import { assignDestination, respondToIncident, setMyStatus, standDownIncident } from "../ui/event-actions";
import { ensureTrackingAlive, refreshTrackingInterval, startLocationLoop } from "../location/location-tracker";
import { isBatteryOptimizationIgnored } from "../location/battery-optimization";
import { debugLog } from "../debug/debug-log";
import type { RouteProfile } from "../navigation/types";
import { isMapScreenMounted, setCarFeedWanted } from "./car-feed";
import { buildDynamic, buildStatic } from "./car-snapshot";
import { startCarRecording, stopCarRecording } from "./car-recorder";
import { DYNAMIC_PUSH_INTERVAL_MS, type CarAction, type CarSettings } from "./car-types";
import {
  carBridgeAvailable,
  isCarConnected,
  onCarAction,
  onCarConnectionChanged,
  pushCarDynamic,
  pushCarStatic,
  setCarEnabled,
} from "./car-native";

/** How long a car banner stays up before it clears itself. */
const TOAST_TTL_MS = 6_000;
/** The slow probes (permissions, battery exemption) refresh on this cadence. */
const PROBE_INTERVAL_MS = 30_000;

let started = false;
let connected = false;
let enabled = true;
/** True while the connect + enabled conditions are both met and we are pushing. */
let projecting = false;

let connectionSub: EmitterSubscription | null = null;
let actionSub: EmitterSubscription | null = null;
let unsubscribers: Array<() => void> = [];
let dynamicTimer: ReturnType<typeof setInterval> | null = null;
let probeTimer: ReturnType<typeof setInterval> | null = null;

let lastDynamicJson = "";
let lastStaticJson = "";
let staticDirty = true;
let recording = false;
let toast: string | null = null;
let toastAt = 0;
/** Slow-probe results, folded into the diagnostics payload. */
let trackingIssues: string[] = [];
let batteryOptimizationIgnored: boolean | null = null;

// ------------------------------------------------------------- lifecycle ----

/**
 * Installs the car bridge. Safe to call on any platform and in any build — on
 * iOS, or an APK without the car app, {@link carBridgeAvailable} is false and
 * this returns immediately.
 */
export function startCarBridge(): void {
  if (started || !carBridgeAvailable) return;
  started = true;

  enabled = useSettingsStore.getState().androidAutoEnabled;
  setCarEnabled(enabled);

  // The enabled switch is watched for the whole app lifetime — it is one
  // boolean comparison per settings write, not per frame.
  useSettingsStore.subscribe((state) => {
    if (state.androidAutoEnabled === enabled) return;
    enabled = state.androidAutoEnabled;
    setCarEnabled(enabled);
    reconcile();
  });

  connectionSub = onCarConnectionChanged((next) => {
    if (connected === next) return;
    connected = next;
    debugLog("app", "info", `android auto ${next ? "connected" : "disconnected"}`);
    reconcile();
  });

  // The native module is constructed the moment `car-native` is imported, and
  // it announces an already-connected car straight away — which, on a headless
  // start, is BEFORE the listener above exists. Missing that first event left
  // the car stuck on its cached snapshot forever, so ask for the current state
  // directly rather than waiting for a transition that already happened.
  void isCarConnected().then((next) => {
    if (connected === next) return;
    connected = next;
    debugLog("app", "info", `android auto already ${next ? "connected" : "disconnected"} at startup`);
    reconcile();
  });

  actionSub = onCarAction((action) => {
    void handleAction(action).catch((err) => debugLog("app", "error", "car action failed", String(err)));
  });
}

/** Tears the bridge down entirely. Only used by tests and hot reload. */
export function stopCarBridge(): void {
  stopProjecting();
  connectionSub?.remove();
  actionSub?.remove();
  connectionSub = null;
  actionSub = null;
  started = false;
}

function reconcile(): void {
  const shouldProject = connected && enabled;
  if (shouldProject === projecting) return;
  if (shouldProject) startProjecting();
  else stopProjecting();
}

function startProjecting(): void {
  projecting = true;
  staticDirty = true;
  lastDynamicJson = "";
  lastStaticJson = "";

  // A cold headless start has nothing in memory yet — read the persisted
  // session/settings before the first push, or the car flashes "sign in".
  void useSettingsStore.getState().hydrate();
  void useZoneVisibilityStore.getState().hydrate();
  void useBuildInfo.getState().hydrate();
  void useSessionStore
    .getState()
    .hydrate()
    .then(() => {
      if (!projecting) return;
      if (isMapScreenMounted()) {
        // The phone UI is up and already owns tracking; just make sure the
        // background task has not died under it.
        void ensureTrackingAlive();
      } else {
        // Headless start: App never mounted, so nothing has started the GPS
        // watch. `ensureTrackingAlive` is not enough here — it returns early
        // when the background task is still registered from a previous run,
        // leaving this process with no live position at all.
        void startLocationLoop().catch((err) =>
          debugLog("location", "error", "car headless location start failed", String(err)),
        );
      }
      pushNow();
    });

  // Anything that changes the STATIC payload just marks it dirty; the push
  // itself rides the same timer as the dynamic one.
  const markStatic = () => {
    staticDirty = true;
  };
  unsubscribers = [
    useMapStore.subscribe((state, previous) => {
      if (state.tracks !== previous.tracks) markStatic();
    }),
    useZonesStore.subscribe(markStatic),
    useZoneVisibilityStore.subscribe(markStatic),
    useBuildInfo.subscribe(markStatic),
  ];

  dynamicTimer = setInterval(pushIfChanged, DYNAMIC_PUSH_INTERVAL_MS);
  probeTimer = setInterval(runProbes, PROBE_INTERVAL_MS);
  void runProbes();

  // Keep the map fed when there is no MapScreen to do it (headless start).
  setCarFeedWanted(true);
  pushIfChanged();
}

function stopProjecting(): void {
  projecting = false;
  setCarFeedWanted(false);
  for (const off of unsubscribers) off();
  unsubscribers = [];
  if (dynamicTimer) clearInterval(dynamicTimer);
  if (probeTimer) clearInterval(probeTimer);
  dynamicTimer = null;
  probeTimer = null;
  lastDynamicJson = "";
  lastStaticJson = "";
}

// ------------------------------------------------------------- push loop ----

function pushIfChanged(): void {
  if (!projecting) return;

  if (staticDirty) {
    staticDirty = false;
    try {
      const json = JSON.stringify(buildStatic());
      if (json !== lastStaticJson) {
        lastStaticJson = json;
        pushCarStatic(json);
      }
    } catch (err) {
      debugLog("app", "warn", "car static snapshot failed", String(err));
    }
  }

  if (toast && Date.now() - toastAt > TOAST_TTL_MS) toast = null;

  try {
    const snapshot = buildDynamic(recording, toast);
    snapshot.diagnostics.trackingIssues = trackingIssues;
    snapshot.diagnostics.batteryOptimizationIgnored = batteryOptimizationIgnored;
    const json = JSON.stringify(snapshot);
    // The car redraws on receipt, so an unchanged payload is a wasted frame.
    if (json === lastDynamicJson) return;
    lastDynamicJson = json;
    pushCarDynamic(json);
  } catch (err) {
    debugLog("app", "warn", "car dynamic snapshot failed", String(err));
  }
}

/** Push on the very next tick rather than waiting out the interval. */
function pushNow(): void {
  lastDynamicJson = "";
  pushIfChanged();
}

function showToast(message: string | null): void {
  toast = message;
  toastAt = Date.now();
  pushNow();
}

async function runProbes(): Promise<void> {
  try {
    batteryOptimizationIgnored = await isBatteryOptimizationIgnored();
  } catch {
    batteryOptimizationIgnored = null;
  }
  const issues: string[] = [];
  if (batteryOptimizationIgnored === false) issues.push("Battery optimization is restricting the app");
  if (!useLocationStatus.getState().lastFix) issues.push("No GPS fix yet");
  if (useBatteryDiagnostics.getState().locationQueueSize > 0) issues.push("Location updates are queued");
  trackingIssues = issues;
}

// ---------------------------------------------------------------- actions ---

async function handleAction(action: CarAction): Promise<void> {
  switch (action.type) {
    case "navigate":
      await startNavigation(action);
      return;
    case "stopNav":
      stopNavigation();
      return;
    case "recenter":
      // Both camera stores treat this as "re-center and reset zoom".
      if (useTrackNavStore.getState().phase !== "idle") useTrackNavStore.getState().toggleCamera();
      else useNavStore.getState().toggleNavCamera();
      return;
    case "toggleVoiceMute":
      if (useTrackNavStore.getState().phase !== "idle") useTrackNavStore.getState().toggleMuted();
      else useNavStore.getState().toggleVoiceMuted();
      pushNow();
      return;
    case "setStatus":
      await applyStatus(action.status);
      return;
    case "respond":
      await respondToIncident(action.incidentId).catch((err) => {
        debugLog("api", "error", "car respond failed", String(err));
        showToast("Could not respond — check signal");
      });
      pushNow();
      return;
    case "standDown":
      await standDownIncident(action.incidentId).catch((err) => {
        debugLog("api", "error", "car stand down failed", String(err));
        showToast("Could not stand down — check signal");
      });
      pushNow();
      return;
    case "setSetting":
      applySetting(action.key, action.value);
      return;
    case "recordStart": {
      if (recording) return;
      const ok = await startCarRecording();
      recording = ok;
      showToast(ok ? "Recording…" : "Microphone unavailable");
      return;
    }
    case "recordStop": {
      if (!recording) return;
      recording = false;
      const outcome = await stopCarRecording(action.send);
      showToast(outcome);
      return;
    }
    case "requestRefresh":
      staticDirty = true;
      pushNow();
      return;
    default:
      return;
  }
}

/**
 * One-tap navigation for the car: open the transport flow, pick the profile
 * this medic's vehicle rides, compute, and start — the three steps the phone
 * asks the user to tap through, with no sheet to tap on a moving bike.
 */
async function startNavigation(action: Extract<CarAction, { type: "navigate" }>): Promise<void> {
  const fix = useLocationStatus.getState().lastFix;
  if (!fix) {
    showToast("Waiting for a GPS fix");
    return;
  }

  const nav = useNavStore.getState();
  nav.openTransport({ lat: action.lat, lng: action.lng, label: action.label }, action.incidentId ?? null);

  const myId = useSessionStore.getState().userId;
  const myVehicle = useRosterStore.getState().medics.find((m) => m.id === myId)?.vehicleType ?? DEFAULT_VEHICLE_TYPE;
  // The final "car" fallback guards a roster vehicle this build has no mapping
  // for — an unroutable `undefined` profile would fail the request outright.
  const profile = (action.profile as RouteProfile | undefined) ?? VEHICLE_DEFAULT_PROFILE[myVehicle] ?? "car";

  showToast(`Routing to ${action.label}…`);
  await useNavStore.getState().selectProfile(profile, { lat: fix.lat, lng: fix.lng });

  const after = useNavStore.getState();
  // The user (or another car action) moved on while we were routing.
  if (after.phase !== "variants" || after.destination?.label !== action.label) return;
  if (after.error || after.routes.length === 0) {
    after.cancel();
    showToast(after.error ?? "No route found");
    return;
  }

  useNavStore.getState().startNavigation();
  showToast(null);
}

function stopNavigation(): void {
  if (useTrackNavStore.getState().phase !== "idle") useTrackNavStore.getState().stop();
  else useNavStore.getState().cancel();
  pushNow();
}

/** Mirrors MedicStatusControl, including the stationary reporting floor. */
async function applyStatus(next: string): Promise<void> {
  const status = next as "available" | "stationary" | "rest" | "sweeper";
  const myId = useSessionStore.getState().userId;
  const markers = useMapStore.getState().markers;
  const wasGoingTo = markers.find((m) => m.id === myId && m.type === "paramedic")?.status === "going_to";
  useMapStore
    .getState()
    .setMarkers(
      markers.map((m) => (m.id === myId && m.type === "paramedic" ? { ...m, status, destination: null } : m)),
    );

  const role = useSessionStore.getState().role;
  const isMedic = role === "medic" || role === "paramedic";
  const stationary = isMedic && status === "stationary";
  if (useSettingsStore.getState().stationaryMode !== stationary) {
    useSettingsStore.getState().setStationaryMode(stationary);
    void refreshTrackingInterval();
  }
  pushNow();

  try {
    await setMyStatus(status);
    // Leaving "going to" also clears the destination the team can see — the
    // same second call the phone's status control makes when standing down.
    if (wasGoingTo) await assignDestination(null);
  } catch (err) {
    debugLog("api", "error", "car set status failed", String(err));
    showToast("Status not saved — check signal");
  }
}

function applySetting(key: keyof CarSettings, value: boolean | number): void {
  const settings = useSettingsStore.getState();
  switch (key) {
    case "locationIntervalMs":
      if (typeof value !== "number") return;
      settings.setLocationIntervalMs(value);
      void refreshTrackingInterval();
      break;
    case "trackOffsetEnabled":
      settings.setTrackOffsetEnabled(Boolean(value));
      break;
    case "trackGradientEnabled":
      settings.setTrackGradientEnabled(Boolean(value));
      break;
    case "kmMarkersEnabled":
      settings.setKmMarkersEnabled(Boolean(value));
      break;
    case "kmMarkerIntervalKm":
      if (typeof value !== "number") return;
      settings.setKmMarkerIntervalKm(value);
      break;
    case "showArchived":
      settings.setShowArchived(Boolean(value));
      break;
    case "androidAutoEnabled":
      settings.setAndroidAutoEnabled(Boolean(value));
      break;
    case "voiceMuted": {
      const muted = Boolean(value);
      if (useTrackNavStore.getState().phase !== "idle") {
        if (useTrackNavStore.getState().muted !== muted) useTrackNavStore.getState().toggleMuted();
      } else if (useNavStore.getState().voiceMuted !== muted) {
        useNavStore.getState().toggleVoiceMuted();
      }
      break;
    }
    default:
      return;
  }
  pushNow();
}
