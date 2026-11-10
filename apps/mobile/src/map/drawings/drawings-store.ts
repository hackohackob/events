import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EventDrawing } from "@events/contracts";
import { fetchDrawings } from "./drawing-api";
import { useSessionStore } from "../../security/session-store";
import { debugLog } from "../../debug/debug-log";

const CACHE_KEY = "drawings-cache/v1";
const PREFS_KEY = "drawings-prefs/v1";

/**
 * Team drawings (ways round hard sections, arrows, lines not to cross) — made
 * on the dashboard, shown here. Filled by a fetch plus `drawing.*` socket
 * events, and cached on disk: a drawing is exactly the kind of thing a medic
 * needs at a post with no reception, so a restart without coverage must still
 * show the last set rather than an empty map.
 *
 * What each device shows is partly its own business: the master switch and the
 * per-drawing hides live here, not on the server. A coordinator's "hidden from
 * the team" is different — those drawings are simply never drawn.
 */
interface DrawingsState {
  drawings: EventDrawing[];
  /** The event `drawings` belongs to — a set is never shown on another event. */
  eventId: string | null;
  /** Master switch for this device. */
  enabled: boolean;
  /** Drawing ids this device chose not to show. */
  hidden: Record<string, true>;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  load: () => Promise<void>;
  upsert: (drawing: EventDrawing) => void;
  remove: (drawingId: string) => void;
  setEnabled: (enabled: boolean) => void;
  setHidden: (drawingId: string, hidden: boolean) => void;
  clear: () => void;
}

function saveCache(drawings: EventDrawing[]): void {
  const eventId = useSessionStore.getState().eventId;
  if (!eventId) return;
  void AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ eventId, drawings })).catch((err) =>
    debugLog("app", "warn", "drawings cache save failed", String(err)),
  );
}

function savePrefs(state: Pick<DrawingsState, "enabled" | "hidden">): void {
  void AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ enabled: state.enabled, hidden: state.hidden })).catch((err) =>
    debugLog("app", "warn", "drawings prefs save failed", String(err)),
  );
}

export const useDrawingsStore = create<DrawingsState>((set, get) => ({
  drawings: [],
  eventId: null,
  enabled: true,
  hidden: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const [rawPrefs, rawCache] = await Promise.all([
        AsyncStorage.getItem(PREFS_KEY),
        AsyncStorage.getItem(CACHE_KEY),
      ]);
      const prefs = rawPrefs ? (JSON.parse(rawPrefs) as Partial<Pick<DrawingsState, "enabled" | "hidden">>) : null;
      const cache = rawCache ? (JSON.parse(rawCache) as { eventId?: string; drawings?: EventDrawing[] }) : null;
      // A cache from another event is someone else's map — never show it.
      const sameEvent = !!cache?.eventId && cache.eventId === useSessionStore.getState().eventId;
      set({
        enabled: prefs?.enabled ?? true,
        hidden: prefs?.hidden ?? {},
        // Live data that already arrived wins over the snapshot.
        drawings: get().drawings.length > 0 ? get().drawings : sameEvent && Array.isArray(cache?.drawings) ? cache.drawings : [],
        eventId: get().eventId ?? (sameEvent ? cache?.eventId ?? null : null),
        hydrated: true,
      });
    } catch (err) {
      debugLog("app", "warn", "drawings hydrate failed", String(err));
      set({ hydrated: true });
    }
  },

  load: async () => {
    await get().hydrate();
    const eventId = useSessionStore.getState().eventId;
    // Joined a different event since the last load: the old set must go now,
    // not only if the fetch below happens to succeed.
    if (get().eventId !== eventId) set({ drawings: [], eventId });
    try {
      const drawings = await fetchDrawings();
      const list = Array.isArray(drawings) ? drawings : [];
      set({ drawings: list, eventId });
      saveCache(list);
    } catch (err) {
      // Offline (the cached set stays on the map), a runner's 403 by design, or
      // a backend that predates drawings — none of them worth more than a line.
      debugLog("api", "warn", "drawings fetch failed — keeping the cached set", String(err));
    }
  },

  upsert: (drawing) => {
    const drawings = get().drawings;
    const index = drawings.findIndex((d) => d.id === drawing.id);
    const next = index === -1 ? [...drawings, drawing] : drawings.map((d) => (d.id === drawing.id ? drawing : d));
    set({ drawings: next });
    saveCache(next);
  },

  remove: (drawingId) => {
    const next = get().drawings.filter((d) => d.id !== drawingId);
    set({ drawings: next });
    saveCache(next);
  },

  setEnabled: (enabled) => {
    set({ enabled });
    savePrefs({ enabled, hidden: get().hidden });
  },

  setHidden: (drawingId, hidden) => {
    const next = { ...get().hidden };
    if (hidden) next[drawingId] = true;
    else delete next[drawingId];
    set({ hidden: next });
    savePrefs({ enabled: get().enabled, hidden: next });
  },

  clear: () => set({ drawings: [], eventId: null }),
}));

/**
 * The drawings this device should actually draw right now.
 *
 * A plain function over the three pieces, not a store selector: it builds a new
 * array every call, and a selector that does that re-renders its component on
 * every store read. Select the pieces, then `useMemo` this.
 */
export function shownDrawings(
  drawings: EventDrawing[],
  enabled: boolean,
  hidden: Record<string, true>,
): EventDrawing[] {
  if (!enabled) return [];
  return drawings.filter((d) => d.visible && !hidden[d.id] && d.lines.length > 0);
}
