import AsyncStorage from "@react-native-async-storage/async-storage";
import { UserRole } from "@events/contracts";
import { create } from "zustand";

const STORAGE_KEY = "@session_v1";

interface SessionState {
  token: string | null;
  eventId: string | null;
  eventTitle: string | null;
  userId: string | null;
  /** Display name from the join response — sent with location fixes so external
   *  guests (not on the roster) still show a human name on the dashboard. */
  name: string | null;
  role: UserRole;
  hydrated: boolean;
  setSession: (next: { token: string; eventId: string; userId: string; role: UserRole; name?: string }) => void;
  setEventTitle: (title: string) => void;
  setRole: (role: UserRole) => void;
  clear: () => void;
  hydrate: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  token: null,
  eventId: null,
  eventTitle: null,
  userId: null,
  name: null,
  role: "runner",
  hydrated: false,

  setSession: (next) => {
    const name = next.name ?? null;
    set({ token: next.token, eventId: next.eventId, userId: next.userId, role: next.role, name });
    void AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ token: next.token, eventId: next.eventId, userId: next.userId, role: next.role, name, eventTitle: get().eventTitle }),
    );
  },

  setEventTitle: (eventTitle) => {
    set({ eventTitle });
    const { token, eventId, userId, role, name } = get();
    if (token) {
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ token, eventId, userId, role, name, eventTitle }));
    }
  },

  setRole: (role) => set({ role }),

  clear: () => {
    set({ token: null, eventId: null, eventTitle: null, userId: null, name: null, role: "runner" });
    void AsyncStorage.removeItem(STORAGE_KEY);
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          token: string;
          eventId: string;
          userId?: string;
          role: UserRole;
          name?: string;
          eventTitle?: string;
        };
        if (saved.token && saved.eventId) {
          const decoded = JSON.parse(atob(saved.token)) as { userId?: string; name?: string };
          set({
            token: saved.token,
            eventId: saved.eventId,
            userId: saved.userId ?? decoded.userId ?? null,
            name: saved.name ?? decoded.name ?? null,
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
