import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "search-recents/v1";
const MAX_RECENTS = 8;

/** A place the medic actually went to, kept so they can go back in one tap. */
export interface RecentSearch {
  lat: number;
  lng: number;
  label: string;
  icon?: string;
  /** ms epoch of the last visit — newest first. */
  at: number;
}

interface RecentsState {
  recents: RecentSearch[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  remember: (entry: Omit<RecentSearch, "at">) => void;
  clear: () => void;
}

/** Same spot within ~10 m counts as the same entry rather than a new one. */
function isSamePlace(a: { lat: number; lng: number; label: string }, b: RecentSearch): boolean {
  if (a.label.trim().toLowerCase() === b.label.trim().toLowerCase()) return true;
  return Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;
}

function persist(recents: RecentSearch[]): void {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(recents)).catch(() => undefined);
}

export const useSearchRecents = create<RecentsState>((set, get) => ({
  recents: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const recents = Array.isArray(parsed)
        ? parsed.filter(
            (r): r is RecentSearch =>
              !!r &&
              typeof r === "object" &&
              Number.isFinite((r as RecentSearch).lat) &&
              Number.isFinite((r as RecentSearch).lng) &&
              typeof (r as RecentSearch).label === "string",
          )
        : [];
      set({ recents: recents.slice(0, MAX_RECENTS), hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  remember: (entry) => {
    const next = [
      { ...entry, at: Date.now() },
      ...get().recents.filter((r) => !isSamePlace(entry, r)),
    ].slice(0, MAX_RECENTS);
    set({ recents: next });
    persist(next);
  },

  clear: () => {
    set({ recents: [] });
    persist([]);
  },
}));
