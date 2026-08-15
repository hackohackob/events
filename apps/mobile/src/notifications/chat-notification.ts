import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { isWithinAudibleHours } from "./audible-hours";
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
 *  - `team-chat-audible-v1` routes the chime through the ALARM audio stream, so
 *    it is still heard on a phone left on silent/vibrate in a pocket. Used
 *    during working hours (see audible-hours.ts).
 *  - `team-chat` is an ordinary notification channel that respects the ringer.
 *    Used the rest of the time.
 *
 * The backend picks the same pair by id for its remote pushes, so a message
 * sounds the same whether the app was running or closed when it arrived.
 */
const CHAT_CHANNEL_ID = "team-chat";
const CHAT_AUDIBLE_CHANNEL_ID = "team-chat-audible-v1";

/** Short and unobtrusive — a text-message buzz, not the incident siren. */
const CHAT_VIBRATION_PATTERN = [0, 120, 90, 120];

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
    vibrationPattern: CHAT_VIBRATION_PATTERN,
  });

  await Notifications.setNotificationChannelAsync(CHAT_AUDIBLE_CHANNEL_ID, {
    name: "Team chat (working hours)",
    description: "Chat messages during the working day — audible even on silent.",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    sound: "default",
    audioAttributes: {
      // USAGE_ALARM plays on the alarm stream, which the silent/vibrate ringer
      // mode does not mute.
      usage: Notifications.AndroidAudioUsage.ALARM,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
    enableVibrate: true,
    vibrationPattern: CHAT_VIBRATION_PATTERN,
  });

  channelsEnsured = true;
}

/**
 * Create the chat channels up front, at launch.
 *
 * The notifications themselves are raised by the backend as remote pushes
 * (event-chat.service.ts → pushChatNotification) rather than from the app's
 * socket handler — that handler only ran while the JS process was alive, which
 * is precisely when chat notifications weren't needed and weren't arriving.
 *
 * Which means the channels must already exist here: Android only applies a
 * channel's configuration when it is first created, and a push naming a channel
 * that doesn't exist yet lands with none of this behaviour.
 */
export async function ensureChatNotificationChannels(): Promise<void> {
  try {
    await ensureChatChannels();
  } catch (err) {
    debugLog("app", "warn", "chat channel setup failed", String(err));
  }
}

/** Which channel the app would use right now — mirrors the server's choice. */
export function currentChatChannelId(): string {
  return isWithinAudibleHours() ? CHAT_AUDIBLE_CHANNEL_ID : CHAT_CHANNEL_ID;
}
