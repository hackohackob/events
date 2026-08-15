import { Platform } from "react-native";
import { debugLog } from "../debug/debug-log";

/**
 * Is the phone's ringer in a state where Android will refuse to play a
 * NOTIFICATION's sound?
 *
 * This is the whole reason the app plays some alert sounds itself. Android
 * applies ringer-mode suppression to notifications before it ever looks at the
 * channel's audio attributes, so on silent or vibrate no channel configuration
 * can make a notification audible. Audio the app plays is not a notification and
 * is not suppressed.
 *
 * Knowing which mode we're in matters in BOTH directions: if we always played
 * our own sound, then in normal ringer mode the user would hear the OS
 * notification and our copy of the same file a beat apart. So the rule is —
 * play it ourselves only when the OS won't.
 *
 * RINGER_MODE: 0 silent, 1 vibrate, 2 normal.
 */
export async function notificationSoundIsSuppressed(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getRingerMode } = require("react-native-volume-manager") as {
      getRingerMode: () => Promise<number | undefined>;
    };
    const mode = await getRingerMode();
    if (mode === undefined) return false;
    return mode === 0 || mode === 1;
  } catch (err) {
    // Binary built before the dependency landed. Assume the OS will handle the
    // sound — a missed extra chime beats doubling every alert.
    debugLog("app", "warn", "ringer mode unavailable", String(err));
    return false;
  }
}
