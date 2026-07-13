import { useEffect, useRef } from "react";
import { Dimensions } from "react-native";
import * as ExpoLocation from "expo-location";
import type { CameraRef } from "@maplibre/maplibre-react-native";
import { useLocationStatus } from "../debug/location-status";
import { sendNavLocationFix } from "../location/location-tracker";
import { noteEnergyEvent } from "../debug/battery-diagnostics";
import { isMapGestureActive } from "../map/map-gesture";
import { distanceMeters } from "../navigation/geo";
import { debugLog } from "../debug/debug-log";
import { useTrackNavStore } from "./track-nav-store";

const SCREEN_H = Dimensions.get("window").height;
const NAV_ZOOM = 16.4;
const NAV_PITCH = 55;

/**
 * Track-following twin of `useNavigationCamera` (kept separate so the existing
 * navigation internals stay untouched):
 *  - runs the same high-frequency foreground GPS watcher while following,
 *  - feeds fixes (incl. device heading) into the track-nav store, and
 *  - eases the tilted follow camera on every progress tick.
 *
 * At most one of the two hooks is ever in its active phase — starting either
 * mode stops the other — so the watchers never run twice.
 */
export function useTrackNavCamera(cameraRef: React.RefObject<CameraRef | null>) {
  const phase = useTrackNavStore((s) => s.phase);
  const progress = useTrackNavStore((s) => s.progress);
  const camMode = useTrackNavStore((s) => s.camMode);
  const recenterTick = useTrackNavStore((s) => s.recenterTick);
  const fix = useLocationStatus((s) => s.lastFix);
  const enteredActive = useRef(false);
  const lastCenter = useRef<[number, number] | null>(null);
  const lastCameraAt = useRef(0);

  const following = phase === "active" || phase === "paused";

  // High-frequency foreground watcher while following (background interval is
  // far too coarse for a moving puck). Runs through "paused" too so progress
  // stays current — only voice + camera-follow pause.
  useEffect(() => {
    if (!following) return;
    let cancelled = false;
    let subscription: ExpoLocation.LocationSubscription | null = null;
    void ExpoLocation.watchPositionAsync(
      {
        accuracy: ExpoLocation.Accuracy.BestForNavigation,
        timeInterval: 1_000,
        distanceInterval: 1,
      },
      (location) => {
        noteEnergyEvent("gpsFix");
        useLocationStatus.getState().setFix({
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          accuracy: location.coords.accuracy ?? undefined,
          // Real fix time so the store can drop the replayed backlog on unlock.
          at: location.timestamp,
        });
        useTrackNavStore.getState().updateProgress({
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          at: location.timestamp,
          heading: location.coords.heading,
        });
        sendNavLocationFix(location);
      },
    )
      .then((sub) => {
        if (cancelled) sub.remove();
        else subscription = sub;
      })
      .catch((err) => debugLog("location", "error", "tracknav foreground watcher failed", String(err)));
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [following]);

  // Fallback feed: fixes landing in the shared location store from elsewhere
  // (e.g. the background tracker before the watcher spins up).
  useEffect(() => {
    if (!following || !fix) return;
    useTrackNavStore.getState().updateProgress({ lat: fix.lat, lng: fix.lng, at: fix.at });
  }, [following, fix]);

  // Ease the camera on each progress tick — identical feel to regular nav.
  useEffect(() => {
    if (phase !== "active" || !progress) return;
    // Fingers on the map: don't fight the gesture; the pinched zoom lands in
    // zoomOverride and the next tick re-centers at it.
    if (isMapGestureActive()) return;
    const focus = progress.offTrack ? progress.raw : progress.snapped;
    const center: [number, number] = [focus.lng, focus.lat];
    const northUp = camMode === "north";

    const now = Date.now();
    const gap = lastCameraAt.current ? now - lastCameraAt.current : 1000;
    const jumpM = lastCenter.current
      ? distanceMeters({ lng: lastCenter.current[0], lat: lastCenter.current[1] }, { lng: center[0], lat: center[1] })
      : 0;
    const duration = jumpM > 80 ? 350 : Math.min(4000, Math.max(700, gap));
    lastCameraAt.current = now;
    lastCenter.current = center;

    cameraRef.current?.easeTo({
      center,
      // Imperative read — subscribing would re-render the map screen at
      // gesture frequency while the user pinches.
      zoom: useTrackNavStore.getState().zoomOverride ?? NAV_ZOOM,
      pitch: northUp ? 0 : NAV_PITCH,
      bearing: northUp ? 0 : progress.bearing,
      padding: northUp
        ? { top: 0, bottom: 0, left: 0, right: 0 }
        : { top: Math.round(SCREEN_H * 0.46), bottom: 120, left: 0, right: 0 },
      duration,
    });
  }, [phase, progress, camMode, recenterTick, cameraRef]);

  // Return to a flat, north-up view when the session ends.
  useEffect(() => {
    if (following) {
      enteredActive.current = true;
      return;
    }
    if (enteredActive.current) {
      enteredActive.current = false;
      const center = lastCenter.current ?? (fix ? ([fix.lng, fix.lat] as [number, number]) : null);
      if (center) {
        cameraRef.current?.easeTo({ center, pitch: 0, bearing: 0, zoom: 15, duration: 500 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following, cameraRef]);
}
