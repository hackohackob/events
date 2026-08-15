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
 * notification, so ringer mode does not suppress it. This needs the JS process
 * to be running — which it normally is, because location tracking keeps a
 * foreground service alive — so it covers the foreground and backgrounded
 * cases. A fully killed app still falls back to whatever the OS manages alone.
 */

/** The bundled 30s siren, the same file the alarm channel points at. */
const SIREN = require("../../assets/sounds/incident_alarm.wav");

/**
 * Hard stop, however the siren was started.
 *
 * The bundled file runs ~30s and not every "I've seen it" gesture is
 * observable: expo-notifications does not report a swipe-away of an
 * OS-rendered notification at all. Rather than leave a siren that can only be
 * silenced by opening the app, it is capped — long enough that nobody sleeps
 * through it, short enough that a missed acknowledgement isn't punishing.
 */
const MAX_SIREN_MS = 15_000;

let player: AudioPlayer | null = null;
let audioModeSet = false;
let capTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Fire the siren. Unconditional: the alarm channel carries no sound of its own,
 * so this is the alert's only voice, in every ringer mode and at every hour.
 *
 * Best-effort throughout — it runs alongside a notification that has already
 * been raised, so a failure here costs the loudness, never the alert itself.
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
    if (capTimer) clearTimeout(capTimer);
    capTimer = setTimeout(stopIncidentSiren, MAX_SIREN_MS);
    debugLog("app", "info", "incident siren playing");
  } catch (err) {
    debugLog("app", "warn", "incident siren failed", String(err));
  }
}

/**
 * Silence the siren — the medic has acknowledged the incident.
 *
 * Called from every path that means "I've seen it": tapping or dismissing the
 * notification, opening the incident, or simply bringing the app to the front.
 * The siren file runs ~30s, and having to sit through it after you have already
 * opened the incident is its own small emergency.
 */
export function stopIncidentSiren(): void {
  try {
    if (capTimer) {
      clearTimeout(capTimer);
      capTimer = null;
    }
    if (!player) return;
    player.pause();
    player.seekTo(0);
    debugLog("app", "info", "incident siren stopped");
  } catch {
    // Nothing useful to do; the file ends on its own.
  }
}
