import { useSessionStore } from "../security/session-store";
import { resolveLocalhostUrl } from "./runtime-host";

const API_BASE_URL = resolveLocalhostUrl(
  process.env.EXPO_PUBLIC_API_URL ?? "https://events-api.hackohackob.com/api",
);

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const state = useSessionStore.getState();
  const headers = new Headers(init?.headers);
  if (state.token) headers.set("authorization", `Bearer ${state.token}`);
  headers.set("x-user-id", "mobile-user");
  headers.set("x-event-id", state.eventId ?? "event-demo");
  headers.set("x-role", state.role);
  headers.set("content-type", "application/json");

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return (await response.json()) as T;
}
