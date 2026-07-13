import notifee, { AndroidGroupAlertBehavior, AndroidImportance, AndroidVisibility } from "@notifee/react-native";
import { Platform } from "react-native";
import { NOTIFICATION_GROUP_ID } from "./foreground-notification";
import { debugLog } from "../debug/debug-log";
import type { EventMessageDto } from "../chat/event-chat-api";

/**
 * Deliberately DEFAULT importance (sound + tray, no heads-up takeover) — team
 * chat is useful but never urgent, and must not compete with the incident
 * alarm channel.
 */
const CHAT_CHANNEL_ID = "team-chat";

let channelEnsured = false;

async function ensureChatChannel(): Promise<void> {
  if (Platform.OS !== "android" || channelEnsured) return;
  await notifee.createChannel({
    id: CHAT_CHANNEL_ID,
    name: "Team chat",
    description: "New messages in the event group chat.",
    importance: AndroidImportance.DEFAULT,
    visibility: AndroidVisibility.PRIVATE,
  });
  channelEnsured = true;
}

function messagePreview(msg: EventMessageDto): string {
  if (msg.kind === "voice") {
    const secs = msg.audioDurationMs ? Math.max(1, Math.round(msg.audioDurationMs / 1000)) : null;
    const length = secs ? ` (${secs}s)` : "";
    return msg.transcript ? `🎤 ${msg.transcript}` : `🎤 Voice message${length}`;
  }
  return msg.text ?? "New message";
}

/**
 * Tray notification for a group-chat message. Callers filter what qualifies
 * (not my own messages, not system/feed cards, app not foregrounded) — this
 * only renders. One notification per author (`id`), so a chatty teammate
 * updates their entry instead of flooding the tray.
 */
export async function showChatNotification(msg: EventMessageDto): Promise<void> {
  try {
    await notifee.requestPermission();
    await ensureChatChannel();
    await notifee.displayNotification({
      id: `chat-${msg.authorId ?? "unknown"}`,
      title: `💬 ${msg.authorName || "Team chat"}`,
      body: messagePreview(msg),
      data: { chat: "1" },
      android: {
        channelId: CHAT_CHANNEL_ID,
        color: "#34d399",
        smallIcon: "ic_launcher",
        groupId: NOTIFICATION_GROUP_ID,
        groupAlertBehavior: AndroidGroupAlertBehavior.CHILDREN,
        pressAction: { id: "default", launchActivity: "default" },
        autoCancel: true,
      },
      ios: { sound: "default" },
    });
  } catch (err) {
    debugLog("app", "error", "chat notification failed", String(err));
  }
}
