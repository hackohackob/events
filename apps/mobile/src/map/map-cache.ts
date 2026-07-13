import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMapStore, type MapMarker, type RaceTrack } from "./map-store";
import { debugLog } from "../debug/debug-log";

/**
 * Last-known map snapshot, persisted so a restart with no coverage still shows
 * the tracks, the medics' last positions, POIs and open incidents instead of
 * an empty map. Live data replaces it the moment any network load succeeds.
 *
 * Runner dots are deliberately NOT cached: there can be thousands, their
 * positions go stale within minutes, and they'd dominate the snapshot size
 * (AsyncStorage rows on Android are capped around 2 MB).
 */
const STORAGE_KEY = "map-cache/v1";
const SAVE_DEBOUNCE_MS = 15_000;
const CACHED_MARKER_TYPES = new Set<MapMarker["type"]>(["paramedic", "infrastructure", "incident"]);

interface MapCacheSnapshot {
  savedAt: number;
  markers: MapMarker[];
  tracks: RaceTrack[];
}

let persistenceStarted = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedMarkers: MapMarker[] | null = null;
let lastSavedTracks: RaceTrack[] | null = null;

async function save(): Promise<void> {
  const { markers, tracks } = useMapStore.getState();
  if (markers === lastSavedMarkers && tracks === lastSavedTracks) return;
  // Nothing loaded yet (e.g. offline start showing the cache itself) — never
  // overwrite a useful snapshot with an empty one.
  const cacheable = markers.filter((m) => CACHED_MARKER_TYPES.has(m.type));
  if (cacheable.length === 0 && tracks.length === 0) return;
  lastSavedMarkers = markers;
  lastSavedTracks = tracks;
  try {
    const snapshot: MapCacheSnapshot = { savedAt: Date.now(), markers: cacheable, tracks };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    // A snapshot that exceeds the storage row limit is a lost cache, not a bug
    // in the map — log and move on.
    debugLog("app", "warn", "map cache save failed", String(err));
  }
}

/** Persist markers+tracks on every store change, debounced. Idempotent. */
export function startMapCachePersistence(): void {
  if (persistenceStarted) return;
  persistenceStarted = true;
  useMapStore.subscribe(() => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void save();
    }, SAVE_DEBOUNCE_MS);
  });
}

/**
 * Populate the map store from the cached snapshot — only where the store is
 * still empty, so a network load that already landed always wins. Returns
 * true when anything was restored.
 */
export async function hydrateMapCacheIfEmpty(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const snapshot = JSON.parse(raw) as MapCacheSnapshot;
    const store = useMapStore.getState();
    let restored = false;
    if (store.markers.length === 0 && Array.isArray(snapshot.markers) && snapshot.markers.length > 0) {
      store.setMarkers(snapshot.markers);
      restored = true;
    }
    if (store.tracks.length === 0 && Array.isArray(snapshot.tracks) && snapshot.tracks.length > 0) {
      store.setTracks(snapshot.tracks);
      restored = true;
    }
    if (restored) {
      debugLog("app", "info", "map restored from offline cache", {
        markers: snapshot.markers.length,
        tracks: snapshot.tracks.length,
        ageMin: Math.round((Date.now() - snapshot.savedAt) / 60_000),
      });
    }
    return restored;
  } catch (err) {
    debugLog("app", "warn", "map cache hydrate failed", String(err));
    return false;
  }
}
