import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { debugLog } from "../debug/debug-log";

/**
 * Team chat gets an SMS-grade alert: the default notification chime and a short
 * double buzz. Deliberately DEFAULT importance (sound + tray, no heads-up
 * takeover) — chat is useful but never urgent, and must not compete with the
 * incident alarm channel.
 *
 * Two channels, because a channel's sound and audio stream are immutable once
 * created and the app needs both behaviours:
 *
 *  - `…-audible-…` puts the chime on the ALARM volume stream, so it is not
 *    dragged down with the notification slider. Used during working hours (see
 *    audible-hours.ts).
 *  - the plain channel uses the notification stream.
 *
 * Note what this does NOT do: it does not make chat audible on a phone set to
 * silent or vibrate. Android suppresses a notification's sound by ringer mode
 * before the channel's audio attributes are consulted — USAGE_ALARM chooses the
 * volume slider, not whether the sound is allowed to play at all. (Verified on
 * a device whose channel reported exactly the config asked for and was still
 * silent on vibrate.) Only audio the app plays itself escapes that, which the
 * incident siren does and chat deliberately does not — chat is not worth
 * overriding a user who has silenced their phone.
 *
 * ── Why the `-v2` suffix ──
 * Android freezes a channel's sound, importance and vibration at CREATION and
 * ignores every later change to the same id. An earlier cut of this reused the
 * old `team-chat` id, which already existed on every install from a build that
 * had specified no sound — so "add a chime" silently did nothing on exactly the
 * devices it was meant for. New behaviour needs a new id.
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
const CHAT_CHANNEL_ID = "team-chat-v2";
const CHAT_AUDIBLE_CHANNEL_ID = "team-chat-audible-v2";
/** Superseded ids, deleted on launch so they don't linger in system settings. */
const LEGACY_CHAT_CHANNEL_IDS = ["team-chat", "team-chat-audible-v1"];

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

  // Created via expo-notifications (not notifee) because only it exposes
  // audioAttributes — the piece that puts the chime on the alarm stream.
  await Notifications.setNotificationChannelAsync(CHAT_CHANNEL_ID, {
    name: "Team chat",
    description: "New messages in the event group chat.",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    sound: "default",
    enableVibrate: true,
    vibrationPattern: CHAT_CHANNEL_VIBRATION_PATTERN,
  });

  await Notifications.setNotificationChannelAsync(CHAT_AUDIBLE_CHANNEL_ID, {
    name: "Team chat (working hours)",
    description: "Chat messages during the working day — audible even on silent.",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    sound: "default",
    audioAttributes: {
      // USAGE_ALARM ties the chime to the alarm volume slider rather than the
      // notification one. It does NOT defeat silent/vibrate — see above.
      usage: Notifications.AndroidAudioUsage.ALARM,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
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
