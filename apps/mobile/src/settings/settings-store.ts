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

/** Selectable spacing for the km chips drawn along tracks. */
export const KM_MARKER_INTERVAL_OPTIONS = [1, 3, 5, 10, 20] as const;

interface SettingsState {
  /** How often to send a location fix to the server (ms). */
  locationIntervalMs: number;
  /** When true, overlapping route lines are drawn offset/parallel ("side by side"). */
  trackOffsetEnabled: boolean;
  /** When true, tracks are shaded by gradient/slope rather than flat colour. */
  trackGradientEnabled: boolean;
  /** Show km distance chips along tracks (toggled from the map layers menu). */
  kmMarkersEnabled: boolean;
  /** Spacing between km chips, in km. */
  kmMarkerIntervalKm: number;
  /**
   * Coordinators only: keep archived incidents and points on the map (dimmed)
   * instead of dropping them. Everyone else gets the clean live picture.
   */
  showArchived: boolean;
  hydrated: boolean;

  setLocationIntervalMs: (ms: number) => void;
  setTrackOffsetEnabled: (enabled: boolean) => void;
  setTrackGradientEnabled: (enabled: boolean) => void;
  setKmMarkersEnabled: (enabled: boolean) => void;
  setKmMarkerIntervalKm: (km: number) => void;
  setShowArchived: (enabled: boolean) => void;
  hydrate: () => Promise<void>;
}

const DEFAULTS = {
  locationIntervalMs: 60_000,
  // Off by default — overlapping tracks draw on top of each other unless the
  // user explicitly asks for the side-by-side spread.
  trackOffsetEnabled: false,
  trackGradientEnabled: true,
  kmMarkersEnabled: true,
  kmMarkerIntervalKm: 5,
  showArchived: false,
};

function persist(
  state: Pick<
    SettingsState,
    | "locationIntervalMs"
    | "trackOffsetEnabled"
    | "trackGradientEnabled"
    | "kmMarkersEnabled"
    | "kmMarkerIntervalKm"
    | "showArchived"
  >,
) {
  void AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      locationIntervalMs: state.locationIntervalMs,
      trackOffsetEnabled: state.trackOffsetEnabled,
      trackGradientEnabled: state.trackGradientEnabled,
      kmMarkersEnabled: state.kmMarkersEnabled,
      kmMarkerIntervalKm: state.kmMarkerIntervalKm,
      showArchived: state.showArchived,
    }),
  );
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  locationIntervalMs: DEFAULTS.locationIntervalMs,
  trackOffsetEnabled: DEFAULTS.trackOffsetEnabled,
  trackGradientEnabled: DEFAULTS.trackGradientEnabled,
  kmMarkersEnabled: DEFAULTS.kmMarkersEnabled,
  kmMarkerIntervalKm: DEFAULTS.kmMarkerIntervalKm,
  showArchived: DEFAULTS.showArchived,
  hydrated: false,

  setLocationIntervalMs: (locationIntervalMs) => {
    set({ locationIntervalMs });
    persist({ ...get(), locationIntervalMs });
  },
  setTrackOffsetEnabled: (trackOffsetEnabled) => {
    set({ trackOffsetEnabled });
    persist({ ...get(), trackOffsetEnabled });
  },
  setTrackGradientEnabled: (trackGradientEnabled) => {
    set({ trackGradientEnabled });
    persist({ ...get(), trackGradientEnabled });
  },
  setKmMarkersEnabled: (kmMarkersEnabled) => {
    set({ kmMarkersEnabled });
    persist({ ...get(), kmMarkersEnabled });
  },
  setKmMarkerIntervalKm: (kmMarkerIntervalKm) => {
    set({ kmMarkerIntervalKm });
    persist({ ...get(), kmMarkerIntervalKm });
  },
  setShowArchived: (showArchived) => {
    set({ showArchived });
    persist({ ...get(), showArchived });
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
          trackGradientEnabled:
            typeof parsed.trackGradientEnabled === "boolean" ? parsed.trackGradientEnabled : DEFAULTS.trackGradientEnabled,
          kmMarkersEnabled:
            typeof parsed.kmMarkersEnabled === "boolean" ? parsed.kmMarkersEnabled : DEFAULTS.kmMarkersEnabled,
          kmMarkerIntervalKm:
            typeof parsed.kmMarkerIntervalKm === "number" ? parsed.kmMarkerIntervalKm : DEFAULTS.kmMarkerIntervalKm,
          showArchived: typeof parsed.showArchived === "boolean" ? parsed.showArchived : DEFAULTS.showArchived,
        });
      }
    } catch {
      // keep defaults
    } finally {
      set({ hydrated: true });
    }
  },
}));
