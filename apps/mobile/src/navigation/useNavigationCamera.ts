import { useEffect, useRef } from "react";
import { Dimensions } from "react-native";
import type { CameraRef } from "@maplibre/maplibre-react-native";
import { useNavStore } from "./nav-store";
import { useLocationStatus } from "../debug/location-status";

const SCREEN_H = Dimensions.get("window").height;
const NAV_ZOOM = 16.8;
const NAV_PITCH = 55;

/**
 * Drives the active-navigation experience:
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

  // Feed GPS into the store while navigating.
  useEffect(() => {
    if (phase !== "active" || !fix) return;
    useNavStore.getState().updateProgress({ lat: fix.lat, lng: fix.lng, at: fix.at });
  }, [phase, fix]);

  // Ease the navigation camera on each progress tick (and on mode/recenter change).
  // "north" keeps the map north-up + flat; "follow" tilts and rotates to travel
  // direction with the puck in the lower third.
  useEffect(() => {
    if (phase !== "active" || !progress) return;
    lastCenter.current = [progress.snapped.lng, progress.snapped.lat];
    const northUp = navCameraMode === "north";
    cameraRef.current?.easeTo({
      center: [progress.snapped.lng, progress.snapped.lat],
      zoom: NAV_ZOOM,
      pitch: northUp ? 0 : NAV_PITCH,
      bearing: northUp ? 0 : progress.bearing,
      // Follow mode pushes the focal point low (route ahead dominant); north-up
      // centers the puck.
      padding: northUp
        ? { top: 0, bottom: 0, left: 0, right: 0 }
        : { top: Math.round(SCREEN_H * 0.46), bottom: 120, left: 0, right: 0 },
      duration: 700,
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
