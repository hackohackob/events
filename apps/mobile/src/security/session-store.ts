import AsyncStorage from "@react-native-async-storage/async-storage";
import { UserRole } from "@events/contracts";
import { create } from "zustand";

const STORAGE_KEY = "@session_v1";

interface SessionState {
  token: string | null;
  eventId: string | null;
  eventTitle: string | null;
  role: UserRole;
  hydrated: boolean;
  setSession: (next: { token: string; eventId: string; role: UserRole }) => void;
  setEventTitle: (title: string) => void;
  setRole: (role: UserRole) => void;
  clear: () => void;
  hydrate: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  token: null,
  eventId: null,
  eventTitle: null,
  role: "runner",
  hydrated: false,

  setSession: (next) => {
    set({ token: next.token, eventId: next.eventId, role: next.role });
    void AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ token: next.token, eventId: next.eventId, role: next.role, eventTitle: get().eventTitle }),
    );
  },

  setEventTitle: (eventTitle) => {
    set({ eventTitle });
    const { token, eventId, role } = get();
    if (token) {
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ token, eventId, role, eventTitle }));
    }
  },

  setRole: (role) => set({ role }),

  clear: () => {
    set({ token: null, eventId: null, eventTitle: null, role: "runner" });
    void AsyncStorage.removeItem(STORAGE_KEY);
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          token: string;
          eventId: string;
          role: UserRole;
          eventTitle?: string;
        };
        if (saved.token && saved.eventId) {
          set({
            token: saved.token,
            eventId: saved.eventId,
            role: saved.role ?? "runner",
            eventTitle: saved.eventTitle ?? null,
          });
        }
      }
    } catch {
      // ignore corrupt storage
    } finally {
      set({ hydrated: true });
    }
  },
}));
