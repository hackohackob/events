import { create } from "zustand";
import type { MedicTrail } from "@events/contracts";
import { fetchTrail } from "./trail-api";
import { debugLog } from "../debug/debug-log";

/**
 * Spans offered in the panel. The numbers are a rolling lookback in hours (12
 * is the API's ceiling); "event" is the archive — the event's own days and
 * daily window, which is how a finished race is reviewed later.
 */
export const TRAIL_WINDOWS = [1, 3, 6, 12, "event"] as const;
export type TrailWindow = (typeof TRAIL_WINDOWS)[number];

interface TrailState {
  /** Whose trail is shown, or null when the feature is closed. `medicId` is
   *  undefined for "mine" — the API resolves that from the session. */
  target: { medicId?: string; name: string } | null;
  window: TrailWindow;
  trail: MedicTrail | null;
  loading: boolean;
  error: string | null;
  /** Scrub position (epoch ms), or null for "show the whole window". */
  cursorMs: number | null;

  open: (target: { medicId?: string; name: string }) => void;
  close: () => void;
  setWindow: (window: TrailWindow) => void;
  setCursor: (cursorMs: number | null) => void;
  reload: () => Promise<void>;
}

/**
 * The single source of truth for the trail overlay. Kept in a store rather than
 * in MapScreen state because two very distant parts of the tree need it — the
 * map layer that draws the line, and the sheet that drives the window and the
 * scrubber.
 */
export const useTrailStore = create<TrailState>((set, get) => ({
  target: null,
  window: 12,
  trail: null,
  loading: false,
  error: null,
  cursorMs: null,

  open: (target) => {
    // Reopening on a different medic must not flash the previous medic's line.
    set({ target, trail: null, cursorMs: null, error: null });
    void get().reload();
  },

  close: () => set({ target: null, trail: null, cursorMs: null, error: null, loading: false }),

  setWindow: (window) => {
    if (get().window === window) return;
    set({ window, cursorMs: null });
    void get().reload();
  },

  setCursor: (cursorMs) => set({ cursorMs }),

  reload: async () => {
    const { target, window } = get();
    if (!target) return;
    set({ loading: true, error: null });
    try {
      const trail = await fetchTrail(window, target.medicId);
      // The window may have changed while the request was in flight.
      if (get().target !== target || get().window !== window) return;
      set({ trail, loading: false });
    } catch (err) {
      debugLog("api", "error", "trail fetch failed", String(err));
      const forbidden = String(err).includes("403");
      set({
        loading: false,
        error: forbidden
          ? "Only coordinators can see another medic's history."
          : "Couldn't load location history.",
      });
    }
  },
}));
