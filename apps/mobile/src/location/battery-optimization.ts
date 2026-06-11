import { Platform, NativeModules } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";

/**
 * Returns true if the app is already exempt from Android battery optimization.
 * Always returns true on iOS (no equivalent concept).
 */
export async function isBatteryOptimizationIgnored(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    // PowerManager.isIgnoringBatteryOptimizations() via the Expo module bridge
    const { PowerManagerModule } = NativeModules;
    if (PowerManagerModule?.isIgnoringBatteryOptimizations) {
      return await PowerManagerModule.isIgnoringBatteryOptimizations();
    }
    // Fallback: assume not ignored — prompt the user
    return false;
  } catch {
    return false;
  }
}

/**
 * Show the one-tap system prompt asking the user to exempt this app from
 * battery optimization (Doze). This is the dialog with an "Allow" button — it
 * is the right call for the common "Optimized" state.
 *
 * Only if that intent is genuinely unavailable (throws) do we fall back to a
 * settings screen. We deliberately do NOT chain into the app-details page on
 * success, since launching it after the prompt buries the dialog.
 */
export async function requestDisableBatteryOptimization(packageName: string): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
      { data: `package:${packageName}` },
    );
  } catch {
    // Device without the prompt → the global battery-optimization list.
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
      );
    } catch {
      // ignore — device may not support it
    }
  }
}

/**
 * Open this app's own details settings page — where Samsung's
 * Battery → Restricted/Optimized/Unrestricted toggle lives. Separate from the
 * Doze prompt above; offered as the manual escape hatch when the app has been
 * moved to "Restricted" and the prompt can't undo that.
 */
export async function openAppDetailsSettings(packageName: string): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
      { data: `package:${packageName}` },
    );
  } catch {
    // ignore
  }
}
