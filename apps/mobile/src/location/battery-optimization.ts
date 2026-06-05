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
 * Opens the system dialog asking the user to disable battery optimization
 * for this app.  On Android < 6 this is a no-op.
 */
export async function requestDisableBatteryOptimization(packageName: string): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
      { data: `package:${packageName}` },
    );
  } catch {
    // Fall back to the general battery settings page
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
      );
    } catch {
      // ignore — device may not support it
    }
  }
}
