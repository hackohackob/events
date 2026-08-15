import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { debugLog } from "../debug/debug-log";

/**
 * Team chat gets an SMS-grade alert: a short chime (played by the app) and a
 * double buzz. Deliberately DEFAULT importance — no heads-up takeover, because
 * chat is useful but never urgent and must not compete with the incident alarm.
 *
 * ── One channel, and it makes no sound ──
 * There used to be two, to choose which volume slider the chime rode. Both are
 * gone: Android suppresses a notification's sound by ringer mode BEFORE the
 * channel's audio attributes are consulted, so no channel could ever be heard
 * on a phone set to vibrate. (Verified on a device whose channel reported
 * exactly the config asked for and was still silent.)
 *
 * So the channel is silent and the app plays the chime itself (chat-chime.ts).
 * That is audio, not a notification, so nothing suppresses it — the same chime
 * is heard in every ringer mode, instead of ours on vibrate and Android's
 * default otherwise. A channel sound on top would just be a second noise a beat
 * behind.
 *
 * ── Why the version suffix ──
 * Android freezes a channel's sound, importance and vibration at CREATION and
 * ignores every later change to the same id, so any change in behaviour needs a
 * new id. An earlier cut reused `team-chat`, which already existed on every
 * install from a build that specified no sound — "add a chime" silently did
 * nothing on exactly the devices it was meant for.
 *
 * ── Why the OS renders these, and why they don't stack ──
 * Folding a burst into one growing tray entry needs the app to own the
 * rendering, because Expo's push API exposes no Android tag or group field.
 * That was tried: chat was sent data-only so the background push task could
 * draw it with notifee. On real devices the task only ran when the app was
 * opened — Android never woke it for a background data message — so messages
 * arrived hours late, when the user opened the app and no longer needed telling.
 * OS-rendered delivery is reliable and costs one tray entry per message. That is
 * the trade, and it is the right way round.
 */
export const CHAT_CHANNEL_ID = "team-chat-v3";
/** Superseded ids, deleted on launch so they don't linger in system settings. */
const LEGACY_CHAT_CHANNEL_IDS = [
  "team-chat",
  "team-chat-audible-v1",
  "team-chat-v2",
  "team-chat-audible-v2",
];

/**
 * Short and unobtrusive — a text-message buzz, not the incident siren.
 *
 * CHANNEL patterns follow the Android convention: index 0 is the initial delay
 * and may be zero. This is only ever set on the channel, never on an individual
 * notification: from Android 8 the channel owns vibration and a notification's
 * own pattern is ignored, and notifee additionally rejects any pattern
 * containing a non-positive value — so setting it per-notification could only
 * ever be a no-op or a thrown error that costs the user the whole notification.
 */
const CHAT_CHANNEL_VIBRATION_PATTERN = [0, 120, 90, 120];

let channelsEnsured = false;

async function ensureChatChannels(): Promise<void> {
  if (Platform.OS !== "android" || channelsEnsured) return;

  await Notifications.setNotificationChannelAsync(CHAT_CHANNEL_ID, {
    name: "Team chat",
    description: "New messages in the event group chat.",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    // Silent by design — see the note above. The chime is played by the app.
    sound: null,
    enableVibrate: true,
    vibrationPattern: CHAT_CHANNEL_VIBRATION_PATTERN,
  });

  for (const id of LEGACY_CHAT_CHANNEL_IDS) {
    await Notifications.deleteNotificationChannelAsync(id).catch(() => undefined);
  }

  channelsEnsured = true;
}

/**
 * Create the chat channels up front, at launch. Android only applies a
 * channel's configuration when it is first created, so they have to exist
 * before the first message arrives.
 */
export async function ensureChatNotificationChannels(): Promise<void> {
  try {
    await ensureChatChannels();
  } catch (err) {
    debugLog("app", "warn", "chat channel setup failed", String(err));
  }
}
