import { joinEvent } from "../api";
import { getEventId, getToken, setToken } from "./storage";
import type { RunnerProfile } from "./types";

/**
 * Ensure we hold a runner session token for the event. Runners need a token so
 * incident reports are attributed to them (and visible via /incidents/mine).
 * The backend requires a name, so the skip-to-SOS path falls back to "Runner".
 */
export async function ensureSession(profile: Partial<RunnerProfile> | null): Promise<void> {
  if (getToken()) return;
  const eventId = getEventId();
  const { token } = await joinEvent({
    joinCode: eventId,
    role: "runner",
    name: profile?.runnerName?.trim() || "Runner",
    bibNumber: profile?.bibNumber || undefined,
    phone: profile?.phone || undefined,
  });
  setToken(token);
}

/** Force a fresh token (e.g. after the runner edits their name/bib). */
export async function refreshSession(profile: Partial<RunnerProfile>): Promise<void> {
  const eventId = getEventId();
  const { token } = await joinEvent({
    joinCode: eventId,
    role: "runner",
    name: profile.runnerName?.trim() || "Runner",
    bibNumber: profile.bibNumber || undefined,
    phone: profile.phone || undefined,
  });
  setToken(token);
}
