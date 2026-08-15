import notifee, { AndroidStyle, type AndroidInboxStyle } from "@notifee/react-native";
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
 *
 * ── Why the `-v2` suffix ──
 * Android freezes a channel's sound, importance and vibration at CREATION and
 * ignores every later change to the same id. An earlier cut of this reused the
 * old `team-chat` id, which already existed on every install from a build that
 * had specified no sound — so "add a chime" silently did nothing on exactly the
 * devices it was meant for. New behaviour needs a new id.
 *
 * ── Why the app renders these instead of the OS ──
 * The backend sends chat DATA-ONLY and the background push task calls in here.
 * Expo's push API exposes no Android tag or group field, so an OS-rendered push
 * can only ever add one tray entry per message; owning the rendering is the only
 * way to fold a burst into a single growing notification.
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
 * Build the expanded inbox style.
 *
 * Keys are only ever ADDED when they hold a real string. notifee validates with
 * `objectHasProperty`, so `{ summary: undefined }` is not the same as omitting
 * `summary` — it fails validation, `displayNotification` throws, and the user
 * gets no notification at all. That is exactly how chat notifications
 * disappeared once already; hence the explicit construction here.
 */
function buildInboxStyle(lines: string[], hiddenCount: number): AndroidInboxStyle {
  const style: AndroidInboxStyle = { type: AndroidStyle.INBOX, lines };
  if (hiddenCount > 0) style.summary = `+${hiddenCount} earlier`;
  return style;
}

/**
 * Fold one more chat message into the single running notification.
 *
 * Called from the background push task. Every message updates the SAME
 * notification id, so a burst of chatter builds one growing entry — "5 new
 * messages" with the last few spelled out — instead of five separate tray
 * entries stacking up.
 */
export async function pushChatMessageNotification(input: ChatNotificationInput): Promise<void> {
  const preview = (input.preview ?? "").trim() || "New message";
  const author = (input.authorName ?? "").trim() || "Team";
  const id = input.messageId ?? `${Date.now()}`;

  let title = `💬 ${author}`;
  let body = preview;
  let style: AndroidInboxStyle | null = null;

  try {
    const buffer = await readBuffer();
    // The same push can be delivered twice (retry, or a task re-run during a
    // cold start) — keyed by message id so a repeat updates nothing.
    if (buffer.some((m) => m.id === id)) return;
    buffer.push({ id, author, preview, at: Date.now() });
    await writeBuffer(buffer);

    const count = buffer.length;
    if (count > 1) {
      title = `💬 Team chat · ${count} new messages`;
      body = `${author}: ${preview}`;
      const lines = buffer.slice(-MAX_LINES).map((m) => `${m.author}: ${m.preview}`);
      style = buildInboxStyle(lines, Math.max(0, count - MAX_LINES));
    }
  } catch (err) {
    // Buffering is a nicety; a broken store must not cost the user the message.
    debugLog("app", "warn", "chat notification buffer failed", String(err));
  }

  await displayChat(title, body, style);
}

/** Display, with a plain fallback so a rejected payload can never mean silence. */
async function displayChat(
  title: string,
  body: string,
  style: AndroidInboxStyle | null,
): Promise<void> {
  const android = {
    channelId: isWithinAudibleHours() ? CHAT_AUDIBLE_CHANNEL_ID : CHAT_CHANNEL_ID,
    color: "#34d399",
    smallIcon: "ic_launcher",
    groupId: NOTIFICATION_GROUP_ID,
    pressAction: { id: "default", launchActivity: "default" },
    autoCancel: true,
    // Each new message still chimes, even though it updates an existing entry —
    // otherwise the second and later messages of a burst would arrive silently.
    onlyAlertOnce: false,
    vibrationPattern: CHAT_VIBRATION_PATTERN,
  };

  try {
    await notifee.requestPermission();
    await ensureChatChannels();
    await notifee.displayNotification({
      id: CHAT_NOTIFICATION_ID,
      title,
      body,
      data: { chat: "1" },
      // Only ever attach `style` when there IS one — see buildInboxStyle.
      android: style ? { ...android, style } : android,
      // iOS has no equivalent lever: playing through the mute switch needs the
      // Critical Alerts entitlement, which this app doesn't hold.
      ios: { sound: "default" },
    });
  } catch (err) {
    debugLog("app", "error", "chat notification failed — retrying unstyled", String(err));
    try {
      await notifee.displayNotification({
        id: CHAT_NOTIFICATION_ID,
        title,
        body,
        data: { chat: "1" },
        android,
        ios: { sound: "default" },
      });
    } catch (retryErr) {
      debugLog("app", "error", "chat notification failed", String(retryErr));
    }
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
