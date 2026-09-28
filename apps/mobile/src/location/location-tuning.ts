import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { DEFAULT_LOCATION_TUNING, LocationTuning } from "@events/contracts";
import { apiFetch } from "../ui/api-client";
import { debugLog } from "../debug/debug-log";

/**
 * Coordinator-tunable accuracy knobs (see LocationTuning in @events/contracts).
 *
 * Arrives three ways, newest version wins:
 *  - the body of every medic location POST — the path that reaches a medic out
 *    in the open who hasn't opened the app since the change;
 *  - a fetch on app start / foreground;
 *  - persisted here, so a headless task run (revived service, silent push)
 *    uses the last known values instead of the defaults.
 */
const STORAGE_KEY = "location-tuning/v1";

interface LocationTuningState {
  tuning: LocationTuning;
  hydrated: boolean;
}

export const useLocationTuning = create<LocationTuningState>(() => ({
  tuning: { ...DEFAULT_LOCATION_TUNING },
  hydrated: false,
}));

export function getLocationTuning(): LocationTuning {
  return useLocationTuning.getState().tuning;
}

export async function hydrateLocationTuning(): Promise<void> {
  if (useLocationTuning.getState().hydrated) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<LocationTuning>;
      // Only if nothing newer arrived while the read was in flight.
      if ((stored.version ?? 0) > useLocationTuning.getState().tuning.version) {
        useLocationTuning.setState({ tuning: { ...DEFAULT_LOCATION_TUNING, ...stored } });
      }
    }
  } catch {
    // defaults are fine
  }
  useLocationTuning.setState({ hydrated: true });
}

type TuningListener = (next: LocationTuning, previous: LocationTuning) => void;
const listeners = new Set<TuningListener>();

/** Called when a new version lands — the tracker uses it to re-apply the tier. */
export function onLocationTuningChange(listener: TuningListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Apply whatever the server sent, if it is newer than what we run. Never throws. */
export function applyLocationTuning(incoming: unknown): void {
  try {
    if (!incoming || typeof incoming !== "object") return;
    const next = { ...DEFAULT_LOCATION_TUNING, ...(incoming as Partial<LocationTuning>) };
    const previous = useLocationTuning.getState().tuning;
    if (next.version <= previous.version) return;
    useLocationTuning.setState({ tuning: next });
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
    debugLog("location", "info", `location tuning v${next.version} applied`, next);
    for (const l of listeners) {
      try {
        l(next, previous);
      } catch {
        // a listener must not break the others
      }
    }
  } catch {
    // never let tuning break a location send
  }
}

let lastFetchAt = 0;
const FETCH_MIN_GAP_MS = 5 * 60_000;

/** Pull the current tuning (app start / foreground). Throttled; never throws. */
export async function refreshLocationTuning(force = false): Promise<void> {
  if (!force && Date.now() - lastFetchAt < FETCH_MIN_GAP_MS) return;
  lastFetchAt = Date.now();
  try {
    applyLocationTuning(await apiFetch<LocationTuning>("/location-tuning"));
  } catch {
    // the next location POST carries it anyway
  }
}
