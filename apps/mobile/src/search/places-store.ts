import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "../ui/api-client";
import { useSessionStore } from "../security/session-store";
import { debugLog } from "../debug/debug-log";

/**
 * Offline place pack for the current event: every named place within 10 km of
 * the event's tracks, downloaded once per event and persisted — these results
 * are available offline and ranked first in the search autocomplete.
 */

export type PlaceCategory =
  | "settlement"
  | "locality"
  | "peak"
  | "pass"
  | "river"
  | "lake"
  | "spring"
  | "waterfall"
  | "cave"
  | "hut"
  | "viewpoint"
  | "other";

export interface EventPlace {
  id: string;
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  region?: string;
  osmValue?: string;
}

const STORAGE_PREFIX = "event-places/v1/";
/** Re-download the pack after this long even if present. */
const REFRESH_MS = 24 * 3600_000;

// Latin → Cyrillic query transliteration, so typing "cherni vrah" finds
// "Черни връх". Digraphs first, then single letters.
const LATIN_DIGRAPHS: Array<[string, string]> = [
  ["sht", "щ"], ["zh", "ж"], ["ch", "ч"], ["sh", "ш"], ["ts", "ц"], ["yu", "ю"], ["ya", "я"], ["kh", "х"],
];
const LATIN_SINGLES: Record<string, string> = {
  a: "а", b: "б", v: "в", g: "г", d: "д", e: "е", z: "з", i: "и", y: "й", k: "к", l: "л",
  m: "м", n: "н", o: "о", p: "п", r: "р", s: "с", t: "т", u: "у", f: "ф", h: "х", c: "ц", j: "дж", w: "в", x: "кс", q: "к",
};

function latinToCyrillic(text: string): string {
  let out = text;
  for (const [latin, cyr] of LATIN_DIGRAPHS) out = out.split(latin).join(cyr);
  return out
    .split("")
    .map((ch) => LATIN_SINGLES[ch] ?? ch)
    .join("");
}

/** Lowercase + strip accents/ъ-е folding for tolerant matching. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ъ/g, "а"); // "Търново" findable as "Тарново"/"Tarnovo"
}

export interface PlaceMatch extends EventPlace {
  /** Higher = better (prefix beats substring beats fuzzy). */
  score: number;
}

interface PlacesState {
  eventId: string | null;
  places: EventPlace[];
  generatedAt: string | null;
  loading: boolean;
  /** Load from disk, then refresh from the server when stale (best-effort). */
  ensureLoaded: () => Promise<void>;
  /** Offline autocomplete over the pack. */
  search: (query: string, limit?: number) => PlaceMatch[];
}

export const usePlacesStore = create<PlacesState>((set, get) => ({
  eventId: null,
  places: [],
  generatedAt: null,
  loading: false,

  ensureLoaded: async () => {
    const eventId = useSessionStore.getState().eventId;
    if (!eventId || get().loading) return;
    if (get().eventId === eventId && get().places.length > 0) {
      // Loaded for this event — refresh in the background only when stale.
      const generatedAt = get().generatedAt;
      if (generatedAt && Date.now() - new Date(generatedAt).getTime() < REFRESH_MS) return;
    }
    set({ loading: true });
    try {
      // 1. Disk cache first — instant + offline.
      if (get().eventId !== eventId) {
        try {
          const raw = await AsyncStorage.getItem(`${STORAGE_PREFIX}${eventId}`);
          if (raw) {
            const parsed = JSON.parse(raw) as { generatedAt: string; places: EventPlace[] };
            set({ eventId, places: parsed.places, generatedAt: parsed.generatedAt });
          } else {
            set({ eventId, places: [], generatedAt: null });
          }
        } catch {
          set({ eventId, places: [], generatedAt: null });
        }
      }
      // 2. Server refresh (best-effort — offline keeps the cached pack).
      const cachedAt = get().generatedAt;
      if (!cachedAt || Date.now() - new Date(cachedAt).getTime() >= REFRESH_MS) {
        try {
          const pack = await apiFetch<{ generatedAt: string; places: EventPlace[] }>("/search/event-places");
          set({ eventId, places: pack.places, generatedAt: pack.generatedAt });
          await AsyncStorage.setItem(`${STORAGE_PREFIX}${eventId}`, JSON.stringify(pack));
          debugLog("api", "info", `offline place pack: ${pack.places.length} place(s)`);
        } catch (err) {
          debugLog("api", "warn", "place pack refresh failed (keeping cache)", String(err));
        }
      }
    } finally {
      set({ loading: false });
    }
  },

  search: (query, limit = 8) => {
    const q = fold(query.trim());
    if (q.length < 2) return [];
    const qCyr = fold(latinToCyrillic(q));
    const matches: PlaceMatch[] = [];
    for (const place of get().places) {
      const name = fold(place.name);
      let score = 0;
      if (name.startsWith(q) || name.startsWith(qCyr)) score = 3;
      else if (name.includes(q) || name.includes(qCyr)) score = 2;
      else {
        // Word-start match ("вр" finds "Черни връх").
        const words = name.split(/\s+/);
        if (words.some((w) => w.startsWith(q) || w.startsWith(qCyr))) score = 1;
      }
      if (score > 0) matches.push({ ...place, score });
    }
    matches.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
    return matches.slice(0, limit);
  },
}));
