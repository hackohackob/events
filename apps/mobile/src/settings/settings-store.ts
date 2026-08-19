import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "app-settings/v1";

/** Selectable cadence for how often the device reports its location. */
export const LOCATION_INTERVAL_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: "30 sec", ms: 30_000 },
  { label: "1 min", ms: 60_000 },
  { label: "3 min", ms: 180_000 },
  { label: "5 min", ms: 300_000 },
  { label: "7 min", ms: 420_000 },
  { label: "20 min", ms: 1_200_000 },
  { label: "40 min", ms: 2_400_000 },
];

/**
 * Cadence forced while the medic's own status is "stationary" — someone holding
 * a post isn't moving, so a fix per minute is pure battery burn. Applied as a
 * floor, never a speed-up: a medic who deliberately chose 20 min keeps 20 min.
 */
export const STATIONARY_INTERVAL_MS = 420_000;

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
  /**
   * Project the app onto the car's screen when Android Auto is connected.
   * Default on — the switch exists so a misbehaving head unit can be shut out
   * mid-event without reinstalling anything.
   */
  androidAutoEnabled: boolean;
  /**
   * Mirrors my own medic status being "stationary". Not persisted — it is
   * re-derived from the live roster on every launch (see MedicStatusControl).
   */
  stationaryMode: boolean;
  hydrated: boolean;

  setStationaryMode: (on: boolean) => void;
  setLocationIntervalMs: (ms: number) => void;
  setTrackOffsetEnabled: (enabled: boolean) => void;
  setTrackGradientEnabled: (enabled: boolean) => void;
  setKmMarkersEnabled: (enabled: boolean) => void;
  setKmMarkerIntervalKm: (km: number) => void;
  setShowArchived: (enabled: boolean) => void;
  setAndroidAutoEnabled: (enabled: boolean) => void;
  hydrate: () => Promise<void>;
}

const DEFAULTS = {
  // 3 minutes is the battery/liveness balance a full race day needs; medics who
  // want a tighter picture can still pick 30 s in Settings.
  locationIntervalMs: 180_000,
  // Off by default — overlapping tracks draw on top of each other unless the
  // user explicitly asks for the side-by-side spread.
  trackOffsetEnabled: false,
  trackGradientEnabled: true,
  kmMarkersEnabled: true,
  kmMarkerIntervalKm: 5,
  showArchived: false,
  androidAutoEnabled: true,
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
    | "androidAutoEnabled"
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
      androidAutoEnabled: state.androidAutoEnabled,
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
  androidAutoEnabled: DEFAULTS.androidAutoEnabled,
  stationaryMode: false,
  hydrated: false,

  setStationaryMode: (stationaryMode) => set({ stationaryMode }),
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
  setAndroidAutoEnabled: (androidAutoEnabled) => {
    set({ androidAutoEnabled });
    persist({ ...get(), androidAutoEnabled });
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
          androidAutoEnabled:
            typeof parsed.androidAutoEnabled === "boolean" ? parsed.androidAutoEnabled : DEFAULTS.androidAutoEnabled,
        });
      }
    } catch {
      // keep defaults
    } finally {
      set({ hydrated: true });
    }
  },
}));

/**
 * The cadence tracking should actually run at: the user's choice, floored to
 * {@link STATIONARY_INTERVAL_MS} while they are holding a post.
 */
export function effectiveLocationIntervalMs(): number {
  const { locationIntervalMs, stationaryMode } = useSettingsStore.getState();
  return stationaryMode ? Math.max(locationIntervalMs, STATIONARY_INTERVAL_MS) : locationIntervalMs;
}
