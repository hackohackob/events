import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "app-settings/v1";

/** Selectable cadence for how often the device reports its location. */
export const LOCATION_INTERVAL_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: "30 sec", ms: 30_000 },
  { label: "1 min", ms: 60_000 },
  { label: "3 min", ms: 180_000 },
  { label: "7 min", ms: 420_000 },
  { label: "20 min", ms: 1_200_000 },
  { label: "40 min", ms: 2_400_000 },
];

interface SettingsState {
  /** How often to send a location fix to the server (ms). */
  locationIntervalMs: number;
  /** When true, overlapping route lines are drawn offset/parallel ("side by side"). */
  trackOffsetEnabled: boolean;
  hydrated: boolean;

  setLocationIntervalMs: (ms: number) => void;
  setTrackOffsetEnabled: (enabled: boolean) => void;
  hydrate: () => Promise<void>;
}

const DEFAULTS = {
  locationIntervalMs: 60_000,
  trackOffsetEnabled: true,
};

function persist(state: Pick<SettingsState, "locationIntervalMs" | "trackOffsetEnabled">) {
  void AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      locationIntervalMs: state.locationIntervalMs,
      trackOffsetEnabled: state.trackOffsetEnabled,
    }),
  );
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  locationIntervalMs: DEFAULTS.locationIntervalMs,
  trackOffsetEnabled: DEFAULTS.trackOffsetEnabled,
  hydrated: false,

  setLocationIntervalMs: (locationIntervalMs) => {
    set({ locationIntervalMs });
    persist({ ...get(), locationIntervalMs });
  },
  setTrackOffsetEnabled: (trackOffsetEnabled) => {
    set({ trackOffsetEnabled });
    persist({ ...get(), trackOffsetEnabled });
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SettingsState>;
        set({
          locationIntervalMs:
            typeof parsed.locationIntervalMs === "number" ? parsed.locationIntervalMs : DEFAULTS.locationIntervalMs,
          trackOffsetEnabled:
            typeof parsed.trackOffsetEnabled === "boolean" ? parsed.trackOffsetEnabled : DEFAULTS.trackOffsetEnabled,
        });
      }
    } catch {
      // keep defaults
    } finally {
      set({ hydrated: true });
    }
  },
}));
