import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { IncidentCategory } from "../api/contracts-shim";
import { useGeolocation, type Fix } from "../hooks/useGeolocation";
import {
  getEventId,
  loadProfile,
  saveProfile as persistProfile,
} from "../lib/storage";
import { postParticipantLocation } from "../api";
import { flushQueue, queuedCount } from "../lib/offline-queue";
import type { RunnerProfile } from "../lib/types";

/** The in-flight incident report being assembled across screens 4→7. */
export interface IncidentDraft {
  category: IncidentCategory;
  fix: Fix | null;
  photos: File[];
}

interface AppValue {
  eventId: string;
  profile: RunnerProfile | null;
  saveProfile: (p: RunnerProfile) => void;
  fix: Fix | null;
  gpsDenied: boolean;
  online: boolean;
  queued: number;
  refreshQueued: () => void;
  draft: IncidentDraft | null;
  startDraft: (category: IncidentCategory) => void;
  setDraftPhotos: (photos: File[]) => void;
  clearDraft: () => void;
}

const AppContext = createContext<AppValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const eventId = useMemo(() => getEventId(), []);
  const [profile, setProfile] = useState<RunnerProfile | null>(() => loadProfile());
  const [online, setOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState(0);
  const [draft, setDraft] = useState<IncidentDraft | null>(null);

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
    void queuedCount().then(setQueued);
  }, []);

  useEffect(() => {
    refreshQueued();
    const goOnline = () => {
      setOnline(true);
      void flushQueue().then(() => refreshQueued());
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
    (category: IncidentCategory) => setDraft({ category, fix, photos: [] }),
    [fix],
  );
  const setDraftPhotos = useCallback(
    (photos: File[]) => setDraft((d) => (d ? { ...d, photos } : d)),
    [],
  );
  const clearDraft = useCallback(() => setDraft(null), []);

  const value: AppValue = {
    eventId,
    profile,
    saveProfile,
    fix,
    gpsDenied: denied,
    online,
    queued,
    refreshQueued,
    draft,
    startDraft,
    setDraftPhotos,
    clearDraft,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
