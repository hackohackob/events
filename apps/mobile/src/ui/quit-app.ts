import { BackHandler, Platform } from "react-native";
import notifee from "@notifee/react-native";
import { stopLocationLoop } from "../location/location-tracker";
import { hideTrackingNotification } from "../notifications/foreground-notification";
import { debugLog } from "../debug/debug-log";

/**
 * Quitting is Android-only. iOS has no public API for terminating your own app,
 * and the HIG treats a self-quit as a crash — shipping one risks review
 * rejection, so the menu hides the button rather than offering a no-op.
 */
export const canQuitApp = Platform.OS === "android";

/**
 * Shut the app down without leaving the event: the session stays on disk, so
 * reopening drops the user straight back onto the map.
 *
 * Tearing down tracking first is what makes this an actual quit. expo-location
 * runs a sticky foreground service, and that service is specifically designed
 * to survive the activity going away — exiting while it holds the process would
 * leave the app running with its notification still in the tray, which is the
 * opposite of what someone tapping "Quit" wants.
 */
export async function quitApp(): Promise<void> {
  debugLog("app", "info", "quit requested — stopping tracking before exit");
  try {
    await stopLocationLoop();
    await hideTrackingNotification();
    // Drop any incident alarm still ringing, so nothing outlives the process.
    await notifee.cancelAllNotifications();
  } catch (err) {
    // Never trap the user in the app because teardown failed.
    debugLog("app", "warn", "quit teardown failed — exiting anyway", String(err));
  }
  BackHandler.exitApp();
}
