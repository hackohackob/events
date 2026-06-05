import { create } from "zustand";

export interface LocationFix {
  lat: number;
  lng: number;
  accuracy?: number;
  battery?: number;
  at: number; // epoch ms when the fix was captured
}

export interface LocationReport {
  at: number; // epoch ms of the attempt
  ok: boolean;
  via: "ws" | "http" | "queue";
  error?: string;
}

interface LocationStatusState {
  lastFix: LocationFix | null;
  lastReport: LocationReport | null;
  setFix: (fix: LocationFix) => void;
  setReport: (report: LocationReport) => void;
}

/**
 * Lightweight, app-wide snapshot of the most recent GPS fix and the most recent
 * server report. Populated by the location tracker, read by the Location debug tab.
 */
export const useLocationStatus = create<LocationStatusState>((set) => ({
  lastFix: null,
  lastReport: null,
  setFix: (lastFix) => set({ lastFix }),
  setReport: (lastReport) => set({ lastReport }),
}));
