import type { RunnerProfile } from "./types";

const PROFILE_KEY = "pe_runner_profile";
const TOKEN_KEY = "pe_token";
const EVENT_KEY = "pe_event";

export function loadProfile(): RunnerProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as RunnerProfile) : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: RunnerProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getEventId(): string {
  // QR deep-link `?event=<id>` wins, then persisted, then the demo default.
  const fromUrl = new URLSearchParams(window.location.search).get("event");
  if (fromUrl) {
    localStorage.setItem(EVENT_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(EVENT_KEY) || "event-demo";
}

/** Bib QRs may preload name/bib via query params (?name=…&bib=…&phone=…). */
export function prefillFromUrl(): Partial<RunnerProfile> {
  const p = new URLSearchParams(window.location.search);
  return {
    runnerName: p.get("name") || undefined,
    bibNumber: p.get("bib") || undefined,
    phone: p.get("phone") || undefined,
  } as Partial<RunnerProfile>;
}
