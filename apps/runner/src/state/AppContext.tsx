import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { IncidentCategory } from "../api/contracts-shim";
import { useGeolocation, type Fix } from "../hooks/useGeolocation";
import {
  getEventId,
  loadProfile,
  saveProfile as persistProfile,
  setEventId as persistEventId,
} from "../lib/storage";
import { fetchEvent, fetchTracks, postParticipantLocation } from "../api";
import {
  flushAttachmentQueue,
  flushQueue,
  queuedAttachmentCount,
  queuedCount,
} from "../lib/offline-queue";
import { trackColor, type EventInfo, type RunnerProfile } from "../lib/types";

/** The in-flight incident report being assembled across screens 4→7. */
export interface IncidentDraft {
  category: IncidentCategory;
  fix: Fix | null;
  photos: File[];
  description: string;
  voice: Blob | null;
  /** True when the report is for the runner themselves. */
  forSelf: boolean;
  /** BIB of the patient when reporting for someone else (optional). */
  patientBib: string | null;
}

/** Who the incident is being reported for, captured in step 1 of the flow. */
export interface ReportSubject {
  forSelf: boolean;
  patientBib: string | null;
}

interface AppValue {
  eventId: string;
  setEventId: (id: string) => void;
  eventInfo: EventInfo | null;
  eventStatus: "idle" | "loading" | "valid" | "invalid";
  validateEvent: (id: string) => Promise<boolean>;
  profile: RunnerProfile | null;
  saveProfile: (p: RunnerProfile) => void;
  fix: Fix | null;
  gpsDenied: boolean;
  online: boolean;
  queued: number;
  refreshQueued: () => void;
  draft: IncidentDraft | null;
  startDraft: (category: IncidentCategory, subject?: ReportSubject) => void;
  patchDraft: (patch: Partial<IncidentDraft>) => void;
  clearDraft: () => void;
}

const AppContext = createContext<AppValue | null>(null);

async function loadEventInfo(id: string): Promise<EventInfo> {
  // Name comes from the event record; selectable tracks come from the tracks
  // endpoint scoped to this event (works pre-join and on event switch).
  const [event, tracks] = await Promise.all([fetchEvent(id), fetchTracks(id).catch(() => [])]);
  return {
    id,
    title: event.title,
    tracks: tracks.map((t, i) => ({ id: t.id, label: t.label, color: trackColor(i, t.color) })),
    commandPhone: event.commandPhone?.trim() || undefined,
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [eventId, setEventIdState] = useState<string>(() => getEventId());
  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [eventStatus, setEventStatus] = useState<"idle" | "loading" | "valid" | "invalid">("idle");
  const [profile, setProfile] = useState<RunnerProfile | null>(() => loadProfile());
  const [online, setOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState(0);
  const [draft, setDraft] = useState<IncidentDraft | null>(null);

  // Resolve the current event whenever it changes. No eventId yet → idle, so
  // onboarding prompts for a code instead of showing a default event's name.
  useEffect(() => {
    if (!eventId) {
      setEventInfo(null);
      setEventStatus("idle");
      return;
    }
    let alive = true;
    // Drop the previous event's info immediately so nothing (e.g. the track
    // picker) can render stale tracks/title while the new event is loading.
    setEventInfo(null);
    setEventStatus("loading");
    loadEventInfo(eventId)
      .then((info) => {
        if (!alive) return;
        setEventInfo(info);
        setEventStatus("valid");
      })
      .catch(() => {
        if (!alive) return;
        setEventInfo(null);
        setEventStatus("invalid");
      });
    return () => {
      alive = false;
    };
  }, [eventId]);

  const setEventId = useCallback((id: string) => {
    persistEventId(id);
    setEventIdState(id);
  }, []);

  // Validate a typed event id; on success switch to it. Returns validity.
  const validateEvent = useCallback(
    async (id: string) => {
      const trimmed = id.trim();
      if (!trimmed) return false;
      try {
        await fetchEvent(trimmed);
        setEventId(trimmed);
        return true;
      } catch {
        setEventStatus("invalid");
        return false;
      }
    },
    [setEventId],
  );

  // Throttled background location stream (every 3 min) feeds the heatmap.
  const { fix, denied } = useGeolocation((f) => {
    void postParticipantLocation(eventId, {
      lat: f.lat,
      lng: f.lng,
      accuracy: f.accuracy,
      timestamp: f.timestamp,
    }).catch(() => undefined);
  });

  const refreshQueued = useCallback(() => {
    void Promise.all([queuedCount(), queuedAttachmentCount()]).then(([incidents, attachments]) =>
      setQueued(incidents + attachments),
    );
  }, []);

  useEffect(() => {
    // Flush on boot too (not just on a live "online" transition) — if the tab
    // was closed while items were queued in IndexedDB, they'd otherwise sit
    // untouched until the browser fires a fresh online event, which may never
    // happen if the app is reopened already-connected.
    void flushQueue()
      .then(() => flushAttachmentQueue())
      .then(() => refreshQueued());
    refreshQueued();
    const goOnline = () => {
      setOnline(true);
      void flushQueue()
        .then(() => flushAttachmentQueue())
        .then(() => refreshQueued());
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [refreshQueued]);

  const saveProfile = useCallback((p: RunnerProfile) => {
    persistProfile(p);
    setProfile(p);
  }, []);

  const startDraft = useCallback(
    (category: IncidentCategory, subject?: ReportSubject) =>
      setDraft({
        category,
        fix,
        photos: [],
        description: "",
        voice: null,
        forSelf: subject?.forSelf ?? true,
        patientBib: subject?.patientBib ?? null,
      }),
    [fix],
  );
  const patchDraft = useCallback(
    (patch: Partial<IncidentDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d)),
    [],
  );
  const clearDraft = useCallback(() => setDraft(null), []);

  const value: AppValue = {
    eventId,
    setEventId,
    eventInfo,
    eventStatus,
    validateEvent,
    profile,
    saveProfile,
    fix,
    gpsDenied: denied,
    online,
    queued,
    refreshQueued,
    draft,
    startDraft,
    patchDraft,
    clearDraft,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
