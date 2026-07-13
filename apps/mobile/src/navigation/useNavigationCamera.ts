import { useEffect, useRef } from "react";
import { Dimensions } from "react-native";
import * as ExpoLocation from "expo-location";
import type { CameraRef } from "@maplibre/maplibre-react-native";
import { useNavStore } from "./nav-store";
import { useLocationStatus } from "../debug/location-status";
import { sendNavLocationFix } from "../location/location-tracker";
import { noteEnergyEvent } from "../debug/battery-diagnostics";
import { isMapGestureActive } from "../map/map-gesture";
import { distanceMeters } from "./geo";
import { debugLog } from "../debug/debug-log";

const SCREEN_H = Dimensions.get("window").height;
const NAV_ZOOM = 16.8;
const NAV_PITCH = 55;

/**
 * Drives the active-navigation experience:
 *  - runs a dedicated high-frequency foreground GPS watcher while navigating
 *    (the background task's interval is far too coarse for a moving puck),
 *  - feeds each GPS fix into the nav store while navigating, and
 *  - on every progress update, eases a zoomed, tilted, travel-direction camera
 *    that keeps the user puck in the lower third with the route ahead dominant.
 *
 * Returns nothing; call once from the map screen with the shared camera ref.
 */
export function useNavigationCamera(cameraRef: React.RefObject<CameraRef | null>) {
  const phase = useNavStore((s) => s.phase);
  const progress = useNavStore((s) => s.progress);
  const navCameraMode = useNavStore((s) => s.navCameraMode);
  const recenterTick = useNavStore((s) => s.recenterTick);
  const fix = useLocationStatus((s) => s.lastFix);
  const enteredActive = useRef(false);
  const lastCenter = useRef<[number, number] | null>(null);
  const lastCameraAt = useRef(0);

  // High-frequency foreground watcher while navigating. The background task
  // reports on the configured interval (30s+) — fine for the dashboard, useless
  // for turn-by-turn. Every fix lands in the location-status store (which the
  // effect below turns into progress); sends to the server are throttled inside
  // sendNavLocationFix.
  useEffect(() => {
    if (phase !== "active") return;
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
          // Real GPS fix time (not Date.now): on unlock the OS replays a backlog
          // of buffered fixes, and only the real timestamps let the nav store
          // recognise and skip the stale ones instead of animating through them.
          at: location.timestamp,
        });
        sendNavLocationFix(location);
      },
    )
      .then((sub) => {
        if (cancelled) sub.remove();
        else subscription = sub;
      })
      .catch((err) => debugLog("location", "error", "nav foreground watcher failed", String(err)));
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [phase]);

  // Feed GPS into the store while navigating.
  useEffect(() => {
    if (phase !== "active" || !fix) return;
    useNavStore.getState().updateProgress({ lat: fix.lat, lng: fix.lng, at: fix.at });
  }, [phase, fix]);

  // Entering the transport picker: zoom out so both me and the destination are
  // on screen (the blue preview arc between them tells the story). The picker
  // sheet covers the lower part of the screen, hence the bottom padding.
  useEffect(() => {
    if (phase !== "transport") return;
    const dest = useNavStore.getState().destination;
    const f = useLocationStatus.getState().lastFix;
    if (!dest || !f) return;
    const minLng = Math.min(f.lng, dest.lng);
    const maxLng = Math.max(f.lng, dest.lng);
    const minLat = Math.min(f.lat, dest.lat);
    const maxLat = Math.max(f.lat, dest.lat);
    const padLng = Math.max((maxLng - minLng) * 0.25, 0.002);
    const padLat = Math.max((maxLat - minLat) * 0.25, 0.002);
    cameraRef.current?.fitBounds(
      [minLng - padLng, minLat - padLat, maxLng + padLng, maxLat + padLat],
      { padding: { top: 90, right: 40, bottom: Math.round(SCREEN_H * 0.45), left: 40 }, duration: 650 },
    );
  }, [phase, cameraRef]);

  // Ease the navigation camera on each progress tick (and on mode/recenter change).
  // "north" keeps the map north-up + flat; "follow" tilts and rotates to travel
  // direction with the puck in the lower third. A pinched zoom is kept until the
  // user re-centers.
  useEffect(() => {
    if (phase !== "active" || !progress) return;
    // Fingers on the map (pinching/panning): stand down for this tick instead
    // of fighting the gesture. The pinched zoom lands in navZoomOverride (via
    // onRegionIsChanging) and the next tick re-centers at that zoom.
    if (isMapGestureActive()) return;
    // Follow the real position when off-route (so the puck stays on-screen),
    // else the snapped point on the line.
    const focus = progress.offRoute ? progress.raw : progress.snapped;
    const center: [number, number] = [focus.lng, focus.lat];
    const northUp = navCameraMode === "north";

    // Adaptive easing: glide over roughly the gap since the last camera move, so
    // movement stays continuous whether fixes arrive every 1s or every 4s
    // (instead of easing 1s then stalling). A big positional jump — e.g. the
    // single catch-up fix after the screen was locked for a while — snaps fast
    // rather than flying across the map for seconds.
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
      // Read the pinch override imperatively: subscribing would re-render the
      // whole map screen at gesture frequency while the user zooms.
      zoom: useNavStore.getState().navZoomOverride ?? NAV_ZOOM,
      pitch: northUp ? 0 : NAV_PITCH,
      bearing: northUp ? 0 : progress.bearing,
      // Follow mode pushes the focal point low (route ahead dominant); north-up
      // centers the puck.
      padding: northUp
        ? { top: 0, bottom: 0, left: 0, right: 0 }
        : { top: Math.round(SCREEN_H * 0.46), bottom: 120, left: 0, right: 0 },
      duration,
    });
  }, [phase, progress, navCameraMode, recenterTick, cameraRef]);

  // Reset the tilt when navigation ends.
  useEffect(() => {
    if (phase === "active") {
      enteredActive.current = true;
      return;
    }
    if (enteredActive.current) {
      enteredActive.current = false;
      // Always return to a flat, north-up view when navigation ends.
      const center =
        lastCenter.current ?? (fix ? ([fix.lng, fix.lat] as [number, number]) : null);
      if (center) {
        cameraRef.current?.easeTo({ center, pitch: 0, bearing: 0, zoom: 15, duration: 500 });
      }
    }
  }, [phase, cameraRef]);
}
