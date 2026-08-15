import notifee, { AndroidStyle } from "@notifee/react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { NOTIFICATION_GROUP_ID } from "./foreground-notification";
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
 *  - `…-audible-…` routes the chime through the ALARM audio stream, so it is
 *    still heard on a phone left on silent/vibrate in a pocket. Used during
 *    working hours (see audible-hours.ts).
 *  - the plain channel is an ordinary notification that respects the ringer.
 *    Used the rest of the time.
 *
 * ── Why the `-v2` suffix ──
 * Android freezes a channel's sound, importance and vibration at CREATION and
 * ignores every later change to the same id. The first cut of this reused the
 * old `team-chat` id, which already existed on every install from an earlier
 * build that had specified no sound — so the "add a chime" change silently did
 * nothing on exactly the devices it was meant for. New behaviour needs a new
 * id. (Same reason the incident channel is on `incident-alarm-v6`.)
 */
const CHAT_CHANNEL_ID = "team-chat-v2";
const CHAT_AUDIBLE_CHANNEL_ID = "team-chat-audible-v2";
/** Superseded ids, deleted on launch so they don't linger in system settings. */
const LEGACY_CHAT_CHANNEL_IDS = ["team-chat", "team-chat-audible-v1"];

/** Short and unobtrusive — a text-message buzz, not the incident siren. */
const CHAT_VIBRATION_PATTERN = [0, 120, 90, 120];

/** One tray entry for the whole conversation; re-displaying this id updates it. */
const CHAT_NOTIFICATION_ID = "team-chat-thread";
const BUFFER_KEY = "chat-notif-buffer/v1";
/** How many messages the expanded notification lists. Older ones are counted
 *  but not spelled out — past half a dozen lines nobody reads them anyway. */
const MAX_LINES = 6;
/** Messages older than this are dropped: a notification still sitting there
 *  from yesterday shouldn't fold into this morning's first message. */
const BUFFER_TTL_MS = 12 * 60 * 60 * 1000;

export interface ChatNotificationInput {
  messageId?: string;
  authorName?: string;
  preview?: string;
}

interface BufferedMessage {
  id: string;
  author: string;
  preview: string;
  at: number;
}

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

async function readBuffer(): Promise<BufferedMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(BUFFER_KEY);
    const saved = raw ? (JSON.parse(raw) as BufferedMessage[]) : [];
    if (!Array.isArray(saved)) return [];
    const cutoff = Date.now() - BUFFER_TTL_MS;
    return saved.filter((m) => m && typeof m.at === "number" && m.at >= cutoff);
  } catch {
    return [];
  }
}

async function writeBuffer(messages: BufferedMessage[]): Promise<void> {
  await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(messages)).catch(() => undefined);
}

/**
 * Fold one more chat message into the single running notification.
 *
 * Called from the background push task. Every message updates the SAME
 * notification id, so a burst of chatter builds one growing entry — "5 new
 * messages" with the last few spelled out — instead of five separate buzzes
 * stacking up in the tray.
 */
export async function pushChatMessageNotification(input: ChatNotificationInput): Promise<void> {
  try {
    const preview = (input.preview ?? "").trim() || "New message";
    const author = (input.authorName ?? "").trim() || "Team";
    const id = input.messageId ?? `${Date.now()}`;

    const buffer = await readBuffer();
    // The same push can be delivered twice (retry, or a task re-run during a
    // cold start) — keyed by message id so a repeat updates nothing.
    if (buffer.some((m) => m.id === id)) return;
    buffer.push({ id, author, preview, at: Date.now() });
    await writeBuffer(buffer);

    await notifee.requestPermission();
    await ensureChatChannels();

    const count = buffer.length;
    const lines = buffer.slice(-MAX_LINES).map((m) => `${m.author}: ${m.preview}`);
    const newest = buffer[buffer.length - 1];

    await notifee.displayNotification({
      id: CHAT_NOTIFICATION_ID,
      title: count === 1 ? `💬 ${newest.author}` : `💬 Team chat · ${count} new messages`,
      body: count === 1 ? newest.preview : `${newest.author}: ${newest.preview}`,
      data: { chat: "1" },
      android: {
        channelId: isWithinAudibleHours() ? CHAT_AUDIBLE_CHANNEL_ID : CHAT_CHANNEL_ID,
        color: "#34d399",
        smallIcon: "ic_launcher",
        groupId: NOTIFICATION_GROUP_ID,
        pressAction: { id: "default", launchActivity: "default" },
        autoCancel: true,
        // Expanding shows the recent lines; collapsed shows the newest.
        style:
          count > 1
            ? {
                type: AndroidStyle.INBOX,
                lines,
                summary: count > MAX_LINES ? `+${count - MAX_LINES} earlier` : undefined,
              }
            : undefined,
        // Each new message still chimes, even though it updates an existing
        // entry — otherwise the second and later messages of a burst would
        // arrive completely silently and nobody would look.
        onlyAlertOnce: false,
        vibrationPattern: CHAT_VIBRATION_PATTERN,
      },
      // iOS has no equivalent lever: playing through the mute switch needs the
      // Critical Alerts entitlement, which this app doesn't hold.
      ios: { sound: "default" },
    });
  } catch (err) {
    debugLog("app", "error", "chat notification failed", String(err));
  }
}

/**
 * The user has read the thread (opened the chat tab) — drop the running
 * notification and start the next burst from zero, so tomorrow's first message
 * doesn't arrive as "12 new messages".
 */
export async function clearChatNotifications(): Promise<void> {
  try {
    await writeBuffer([]);
    await notifee.cancelNotification(CHAT_NOTIFICATION_ID);
  } catch (err) {
    debugLog("app", "warn", "chat notification clear failed", String(err));
  }
}

/**
 * Create the chat channels up front, at launch.
 *
 * The notifications themselves are raised from the background push task
 * (event-chat.service.ts sends them data-only) rather than from the app's
 * socket handler — that handler only ran while the JS process was alive, which
 * is precisely when chat notifications weren't needed and weren't arriving.
 */
export async function ensureChatNotificationChannels(): Promise<void> {
  try {
    await ensureChatChannels();
  } catch (err) {
    debugLog("app", "warn", "chat channel setup failed", String(err));
  }
}
