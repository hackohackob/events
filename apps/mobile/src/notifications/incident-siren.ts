import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { ensureAlarmStreamVolume } from "./broadcast-notification";
import { debugLog } from "../debug/debug-log";

/**
 * Plays the incident siren as ordinary audio, instead of relying on the
 * notification's own sound.
 *
 * Why this exists: on Android, a NOTIFICATION's sound is suppressed whenever
 * the ringer is on silent or vibrate — and that suppression is applied by the
 * system before the channel's audio attributes matter. Setting USAGE_ALARM on
 * the channel only decides which volume slider controls the loudness; it does
 * NOT make the notification behave like an alarm clock. The device's channel
 * dump confirmed this: importance MAX, custom sound, audioUsage 4 (ALARM),
 * everything the app asked for — and still silent on vibrate.
 *
 * Audio the app plays itself is a different path entirely. It is not a
 * notification, so ringer mode does not suppress it, and it is audible with the
 * phone on vibrate. This needs the JS process to be running — which it normally
 * is, because location tracking keeps a foreground service alive — so it covers
 * the foreground and backgrounded cases. A fully killed app still falls back to
 * whatever the OS notification manages on its own.
 */

/** The bundled 30s siren, the same file the alarm channel points at. */
const SIREN = require("../../assets/sounds/incident_alarm.wav");

let player: AudioPlayer | null = null;
let audioModeSet = false;

/**
 * Fire the siren. Best-effort throughout: this runs alongside a notification
 * that has already been raised, so a failure here costs the extra loudness,
 * never the alert itself.
 */
export async function playIncidentSiren(): Promise<void> {
  try {
    // Push the alarm slider up first — the file is loud, the slider may not be.
    await ensureAlarmStreamVolume();

    if (!audioModeSet) {
      // iOS: play through the mute switch. Android ignores this flag, and gets
      // its audibility from not being a notification in the first place.
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
      audioModeSet = true;
    }

    // One player, reused. A second incident while the first is still sounding
    // restarts it rather than layering two sirens on top of each other.
    if (!player) player = createAudioPlayer(SIREN);
    player.seekTo(0);
    player.play();
    debugLog("app", "info", "incident siren playing");
  } catch (err) {
    debugLog("app", "warn", "incident siren failed", String(err));
  }
}

/** Stop the siren early — the medic has seen the incident. */
export function stopIncidentSiren(): void {
  try {
    player?.pause();
  } catch {
    // Nothing useful to do; the file stops on its own after ~30s.
  }
}
