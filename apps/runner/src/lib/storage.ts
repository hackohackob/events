import type { MedicalInfo, RunnerProfile } from "./types";

const PROFILE_KEY = "pe_runner_profile";
const MEDICAL_KEY = "pe_medical";
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

export function loadMedical(): MedicalInfo | null {
  try {
    const raw = localStorage.getItem(MEDICAL_KEY);
    return raw ? (JSON.parse(raw) as MedicalInfo) : null;
  } catch {
    return null;
  }
}

export function saveMedical(info: MedicalInfo): void {
  localStorage.setItem(MEDICAL_KEY, JSON.stringify(info));
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
  // No default — without a QR query or a previously chosen event, the runner
  // must enter a code first (so we don't show a random event's name).
  return localStorage.getItem(EVENT_KEY) || "";
}

/** Whether the app was opened with an explicit ?event= query (the QR path). */
export function hasEventQuery(): boolean {
  return new URLSearchParams(window.location.search).has("event");
}

export function setEventId(id: string): void {
  localStorage.setItem(EVENT_KEY, id);
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
