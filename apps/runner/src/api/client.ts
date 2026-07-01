import type { SessionPayload } from "@events/contracts";
import { getToken } from "../lib/storage";

const BASE = (import.meta.env.VITE_API_URL as string) || "/api";

function decodeSession(token: string | null): SessionPayload | null {
  if (!token) return null;
  try {
    return JSON.parse(atob(token)) as SessionPayload;
  } catch {
    return null;
  }
}

/** Headers the backend AuthGuard reads (mirrors the coordinator web client). */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  const session = decodeSession(token);
  const h: Record<string, string> = {};
  if (token) h["x-auth-token"] = token;
  if (session) {
    h["x-user-id"] = session.userId;
    h["x-event-id"] = session.eventId;
    h["x-role"] = session.role;
  }
  return h;
}

export async function apiGet<T>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
  // no-store: event/track lookups must never be served from the HTTP cache —
  // switching events must always hit the network for the new event's data.
  const res = await fetch(`${BASE}${path}`, { headers: { ...authHeaders(), ...extraHeaders }, cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export { BASE as API_BASE };
