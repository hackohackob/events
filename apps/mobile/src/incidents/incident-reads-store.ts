import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "incident-reads/v1";

function parseMs(at: string | number | null | undefined): number | null {
  if (at == null) return null;
  const ms = typeof at === "number" ? at : Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

interface IncidentReadsState {
  /** Last time the user opened each incident's thread (epoch ms). Persisted. */
  lastReadAt: Record<string, number>;
  /** Newest message timestamp seen for each incident (epoch ms). Runtime only —
   *  re-seeded from the server on every incident fetch. */
  latestMessageAt: Record<string, number>;

  /**
   * Seed an incident's newest-message time from the server list. On first sight
   * the user is treated as caught up (baseline = current newest), so existing
   * threads don't all light up; only messages that arrive *after* this baseline
   * (via `noteMessage`) count as unread.
   */
  observe: (incidentId: string, lastMessageAt?: string | number | null) => void;
  /** A live message arrived → mark the incident unread (unless already read past it). */
  noteMessage: (incidentId: string, at?: string | number | null) => void;
  /** The user opened the thread → everything up to now is read. */
  markRead: (incidentId: string) => void;
  hydrate: () => Promise<void>;
}

function persist(lastReadAt: Record<string, number>) {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lastReadAt));
}

export const useIncidentReadsStore = create<IncidentReadsState>((set, get) => ({
  lastReadAt: {},
  latestMessageAt: {},

  observe: (incidentId, lastMessageAt) => {
    const ms = parseMs(lastMessageAt);
    if (ms == null) return;
    const state = get();
    const nextLatest = Math.max(state.latestMessageAt[incidentId] ?? 0, ms);
    const patch: Partial<IncidentReadsState> = {
      latestMessageAt: { ...state.latestMessageAt, [incidentId]: nextLatest },
    };
    // First time we've seen this incident → baseline the read marker to the
    // current newest message so pre-existing threads aren't flagged unread.
    if (state.lastReadAt[incidentId] === undefined) {
      const lastReadAt = { ...state.lastReadAt, [incidentId]: ms };
      patch.lastReadAt = lastReadAt;
      persist(lastReadAt);
    }
    set(patch);
  },

  noteMessage: (incidentId, at) => {
    const ms = parseMs(at) ?? Date.now();
    const state = get();
    set({
      latestMessageAt: {
        ...state.latestMessageAt,
        [incidentId]: Math.max(state.latestMessageAt[incidentId] ?? 0, ms),
      },
    });
  },

  markRead: (incidentId) => {
    const state = get();
    const readAt = Math.max(Date.now(), state.latestMessageAt[incidentId] ?? 0);
    const lastReadAt = { ...state.lastReadAt, [incidentId]: readAt };
    set({ lastReadAt });
    persist(lastReadAt);
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, number>;
        if (parsed && typeof parsed === "object") set({ lastReadAt: parsed });
      }
    } catch {
      // keep empty
    }
  },
}));

/** True when an incident has a message newer than the user's last read. */
export function incidentHasUnread(
  incidentId: string,
  lastReadAt: Record<string, number>,
  latestMessageAt: Record<string, number>,
): boolean {
  return (latestMessageAt[incidentId] ?? 0) > (lastReadAt[incidentId] ?? 0);
}
