import { useEffect, useState } from "react";
import { AppState } from "react-native";
import * as ExpoLocation from "expo-location";
import * as TaskManager from "expo-task-manager";
import { LOCATION_TASK_NAME } from "./location-tracker";
import { isBatteryOptimizationIgnored } from "./battery-optimization";

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
 * restriction) so the UI can flag a problem on the locate button. Re-checks on
 * a slow interval and whenever the app returns to the foreground (the user may
 * have just toggled a setting).
 */
export function useTrackingHealth(): TrackingHealth {
  const [health, setHealth] = useState<TrackingHealth>({ ok: true, issues: [] });

  useEffect(() => {
    let active = true;
    const check = () => void readTrackingHealth().then((h) => active && setHealth(h));
    check();
    const interval = setInterval(check, 20_000);
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") check();
    });
    return () => {
      active = false;
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  return health;
}
