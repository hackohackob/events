import { useSessionStore } from "../security/session-store";
import { resolveLocalhostUrl } from "./runtime-host";
import { debugLog } from "../debug/debug-log";
import { noteEnergyEvent } from "../debug/battery-diagnostics";

const API_BASE_URL = resolveLocalhostUrl(
  process.env.EXPO_PUBLIC_API_URL ?? "https://events-api.hackohackob.com/api",
);

/** Server origin without the `/api` prefix — static uploads live at `<origin>/uploads/...`. */
const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

/**
 * Resolve a server-relative media path (e.g. "/uploads/incidents/x.jpg",
 * returned by the upload endpoint) into an absolute, fetchable URL. Absolute
 * URLs and local file:// URIs are returned unchanged.
 */
export function resolveMediaUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^(https?:|file:|data:)/.test(path)) return path;
  return `${API_ORIGIN}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Error thrown for non-2xx responses, carrying status + server body for diagnosis. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly path: string,
  ) {
    super(`API ${status} on ${path}: ${body.slice(0, 300)}`);
    this.name = "ApiError";
  }
}

/**
 * Hard cap on how long a request may hold the radio. On the edge of coverage a
 * fetch can otherwise hang for minutes in the OS network stack, keeping the
 * cell radio in its high-power state — one of the main battery drains observed
 * at remote events. Failing fast also hands the payload to the offline queue
 * sooner, which is where it belongs.
 */
const REQUEST_TIMEOUT_MS = 15_000;

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const state = useSessionStore.getState();
  const headers = new Headers(init?.headers);
  if (state.token) headers.set("authorization", `Bearer ${state.token}`);
  headers.set("x-user-id", state.userId ?? "mobile-user");
  headers.set("x-event-id", state.eventId ?? "event-demo");
  headers.set("x-role", state.role);
  headers.set("content-type", "application/json");

  const method = (init?.method ?? "GET").toUpperCase();
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, signal: init?.signal ?? abort.signal });
  } catch (networkErr) {
    noteEnergyEvent("apiNetworkError");
    debugLog("api", "error", `${method} ${path} network error`, String(networkErr));
    throw networkErr;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    debugLog("api", "error", `${method} ${path} → ${response.status}`, body.slice(0, 300));
    throw new ApiError(response.status, body, path);
  }

  // Some endpoints (204) return no body
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
