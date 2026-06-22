import { apiFetch } from "../ui/api-client";
import { useSessionStore } from "../security/session-store";
import { resolveLocalhostUrl } from "../ui/runtime-host";

const API_BASE_URL = resolveLocalhostUrl(
  process.env.EXPO_PUBLIC_API_URL ?? "https://events-api.hackohackob.com/api",
);

export type EventMessageKind = "text" | "voice" | "system";
export type EventFeedType = "incident" | "response" | "poi";

export interface EventMessageDto {
  id: string;
  eventId: string;
  authorId: string | null;
  authorName: string;
  kind: EventMessageKind;
  feedType?: EventFeedType;
  text?: string;
  audioUrl?: string;
  audioDurationMs?: number;
  transcript?: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export async function listEventMessages(): Promise<EventMessageDto[]> {
  return apiFetch<EventMessageDto[]>("/event-chat/messages");
}

export async function sendEventMessage(text: string): Promise<EventMessageDto> {
  return apiFetch<EventMessageDto>("/event-chat/messages", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function uploadEventVoice(uri: string, durationMs: number): Promise<EventMessageDto> {
  const state = useSessionStore.getState();
  const formData = new FormData();
  const filename = uri.split("/").pop() ?? "voice.m4a";
  const match = /\.(\w+)$/.exec(filename);
  const type = match ? `audio/${match[1]}` : "audio/m4a";
  formData.append("audio", { uri, name: filename, type } as unknown as Blob);
  formData.append("durationMs", String(Math.round(durationMs)));

  const headers = new Headers();
  if (state.token) headers.set("authorization", `Bearer ${state.token}`);
  headers.set("x-user-id", state.userId ?? "mobile-user");
  headers.set("x-event-id", state.eventId ?? "event-demo");
  headers.set("x-role", state.role);

  const response = await fetch(`${API_BASE_URL}/event-chat/voice`, { method: "POST", headers, body: formData });
  if (!response.ok) throw new Error(`Voice upload failed: ${response.status}`);
  return response.json() as Promise<EventMessageDto>;
}
