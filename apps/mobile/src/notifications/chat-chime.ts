import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { notificationSoundIsSuppressed } from "./ringer";
import { isWithinAudibleHours } from "./audible-hours";
import { debugLog } from "../debug/debug-log";

/**
 * A short chime for incoming team chat, played by the app rather than by the
 * notification.
 *
 * The chat channel itself is silent, so this is the ONLY chat sound: the same
 * chime in every ringer mode, rather than ours on vibrate and Android's default
 * otherwise. It started as a workaround — Android refuses to sound a
 * notification while the ringer is on silent or vibrate, whatever the channel
 * says, so a medic riding with the phone on vibrate never heard a message — and
 * owning the sound outright turned out to be simpler than splitting the
 * behaviour by ringer mode.
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
 * This is the part that keeps a busy channel bearable: a rapid back-and-forth
 * makes a sound every few seconds rather than once per message. The
 * notifications themselves still all arrive — this only governs how often the
 * phone makes a noise about them.
 */
const MIN_GAP_MS = 5_000;

let player: AudioPlayer | null = null;
let audioModeSet = false;
let lastChimeAt = 0;

export async function playChatChime(): Promise<void> {
  try {
    const now = Date.now();
    if (now - lastChimeAt < MIN_GAP_MS) return;

    // The chat channel is silent, so this is the only chat sound there is — it
    // plays whatever the ringer is doing. The one exception: a phone that has
    // been deliberately silenced outside working hours should stay silent.
    // Overriding the ringer is justified while someone is on duty, not at 3am.
    if (!isWithinAudibleHours() && (await notificationSoundIsSuppressed())) return;

    lastChimeAt = now;

    if (!audioModeSet) {
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
      audioModeSet = true;
    }
    if (!player) player = createAudioPlayer(CHIME);
    // Full scale within the media stream, but deliberately NO volume boost:
    // forcing the slider up is right for an incident and far too much for a
    // chat message. Chat plays at whatever level the phone is already set to.
    player.volume = 1.0;
    player.seekTo(0);
    player.play();
  } catch (err) {
    debugLog("app", "warn", "chat chime failed", String(err));
  }
}
