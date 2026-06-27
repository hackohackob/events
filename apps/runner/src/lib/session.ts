import { joinEvent, registerParticipant } from "../api";
import { getEventId, getToken, setToken, loadProfile, loadMedical } from "./storage";
import type { MedicalInfo, RunnerProfile } from "./types";

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

/**
 * Push the runner's identity/track + opt-in medical to the backend so medics
 * can resolve a patient by BIB and the dashboard roster is populated. Falls back
 * to the persisted profile/medical when not passed. Best-effort — never throws.
 */
export async function syncParticipantProfile(
  profile?: RunnerProfile | null,
  medical?: MedicalInfo | null,
): Promise<void> {
  const p = profile ?? loadProfile();
  if (!p) return;
  const m = medical ?? loadMedical();
  const eventId = getEventId();
  if (!eventId) return;
  try {
    await registerParticipant(eventId, {
      name: p.runnerName?.trim() || "Runner",
      bibNumber: p.bibNumber || undefined,
      phone: p.phone || undefined,
      trackId: p.selectedTrackId || undefined,
      trackLabel: p.selectedTrackLabel || undefined,
      allergies: m?.allergies?.trim() || undefined,
      medications: m?.medications?.trim() || undefined,
      bloodType: m?.bloodType?.trim() || undefined,
      conditions: m?.conditions?.trim() || undefined,
    });
  } catch {
    // Best-effort: a failed sync must never block the runner UX.
  }
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
