import { useEffect, useRef, useState } from "react";
import * as ExpoLocation from "expo-location";
import * as TaskManager from "expo-task-manager";
import { LOCATION_TASK_NAME } from "./location-tracker";
import { isBatteryOptimizationIgnored } from "./battery-optimization";
import { useForegroundInterval } from "../ui/useForegroundInterval";

export interface TrackingHealth {
  ok: boolean;
  /** Human-readable reasons tracking may be unreliable. */
  issues: string[];
}

async function readTrackingHealth(): Promise<TrackingHealth> {
  const issues: string[] = [];
  try {
    const fg = await ExpoLocation.getForegroundPermissionsAsync();
    if (fg.status !== "granted") issues.push("Location permission not granted");
    const bg = await ExpoLocation.getBackgroundPermissionsAsync();
    if (bg.status !== "granted") issues.push("“Allow all the time” location not granted");
    const registered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
    if (!registered) issues.push("Background tracking is not running");
    const battExempt = await isBatteryOptimizationIgnored();
    if (!battExempt) issues.push("Battery optimization is restricting the app");
  } catch {
    // Treat probe failures as unknown-but-not-blocking.
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Poll the tracking-health signals (permissions, background task, battery
 * restriction) so the UI can flag a problem on the locate button.
 *
 * Foreground-only, and deliberately so: every pass is four native round trips,
 * and it exists purely to colour an icon. Behind a locked screen it was 180
 * probes an hour that nothing could act on — the user cannot grant a permission
 * they are not looking at. Returning to the app re-checks immediately (the
 * leading tick), which is exactly when a setting may have just been toggled.
 */
export function useTrackingHealth(): TrackingHealth {
  const [health, setHealth] = useState<TrackingHealth>({ ok: true, issues: [] });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useForegroundInterval(() => {
    void readTrackingHealth().then((h) => {
      if (alive.current) setHealth(h);
    });
  }, 20_000);

  return health;
}
