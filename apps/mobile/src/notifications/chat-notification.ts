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
 *  - `…-audible-…` routes the chime through the ALARM audio stream, so it is
 *    still heard on a phone left on silent/vibrate in a pocket. Used during
 *    working hours (see audible-hours.ts); the backend picks the same one by id.
 *  - the plain channel is an ordinary notification that respects the ringer.
 *
 * ── Why the `-v2` suffix ──
 * Android freezes a channel's sound, importance and vibration at CREATION and
 * ignores every later change to the same id. An earlier cut of this reused the
 * old `team-chat` id, which already existed on every install from a build that
 * had specified no sound — so "add a chime" silently did nothing on exactly the
 * devices it was meant for. New behaviour needs a new id.
 *
 * ── Why the app does not render these ──
 * These notifications are delivered by the OS from a normal Expo push payload.
 * A previous attempt sent them data-only so the app could fold a burst into one
 * growing tray entry (Expo's push API cannot set an Android tag or group, so
 * only app-side rendering can group them). The background task that would have
 * rendered them does not reliably run on real devices — incident alarms had
 * already been moved off data-only for the same reason — and chat notifications
 * stopped arriving at all. Reliable delivery beats tidy grouping.
 */
const CHAT_CHANNEL_ID = "team-chat-v2";
const CHAT_AUDIBLE_CHANNEL_ID = "team-chat-audible-v2";
/** Superseded ids, deleted on launch so they don't linger in system settings. */
const LEGACY_CHAT_CHANNEL_IDS = ["team-chat", "team-chat-audible-v1"];

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

  for (const id of LEGACY_CHAT_CHANNEL_IDS) {
    await Notifications.deleteNotificationChannelAsync(id).catch(() => undefined);
  }

  channelsEnsured = true;
}

/**
 * Create the chat channels up front, at launch. The backend's pushes name these
 * ids directly, so they have to exist before the first message arrives —
 * a push naming a channel that doesn't exist yet lands with none of this
 * behaviour (and on some OEMs not at all).
 */
export async function ensureChatNotificationChannels(): Promise<void> {
  try {
    await ensureChatChannels();
  } catch (err) {
    debugLog("app", "warn", "chat channel setup failed", String(err));
  }
}
