import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { notificationSoundIsSuppressed } from "./ringer";
import { debugLog } from "../debug/debug-log";

/**
 * A short chime for incoming team chat, played by the app rather than by the
 * notification.
 *
 * Same reason as the incident siren (see incident-siren.ts): Android refuses to
 * sound a notification while the ringer is on silent or vibrate, whatever the
 * channel says. A medic riding with the phone on vibrate would otherwise never
 * hear a message.
 *
 * The sound is deliberately mild — a soft rising fifth with a bell decay,
 * under a second. The design brief was "something I can hear over the ride, but
 * that won't make me mute the app when twenty people are talking", and a chime
 * people turn off is worth less than no chime at all.
 */

const CHIME = require("../../assets/sounds/chat_chime.wav");

/**
 * Never more than one chime per this window, however many messages land.
 *
 * This is the part that keeps a busy channel bearable: twenty messages during a
 * descent produce one chime, not twenty. The notifications themselves still all
 * arrive — this only governs how often the phone makes a noise about them.
 */
const MIN_GAP_MS = 20_000;

let player: AudioPlayer | null = null;
let audioModeSet = false;
let lastChimeAt = 0;

export async function playChatChime(): Promise<void> {
  try {
    const now = Date.now();
    if (now - lastChimeAt < MIN_GAP_MS) return;

    // In normal ringer mode the notification's own chime plays; ours would just
    // be a second sound on top of it.
    if (!(await notificationSoundIsSuppressed())) return;

    lastChimeAt = now;

    if (!audioModeSet) {
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
      audioModeSet = true;
    }
    if (!player) player = createAudioPlayer(CHIME);
    player.seekTo(0);
    player.play();
  } catch (err) {
    debugLog("app", "warn", "chat chime failed", String(err));
  }
}
