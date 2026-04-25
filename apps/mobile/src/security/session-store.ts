import { UserRole } from "@events/contracts";
import { create } from "zustand";

interface SessionState {
  token: string | null;
  eventId: string | null;
  role: UserRole;
  setSession: (next: { token: string; eventId: string; role: UserRole }) => void;
  setRole: (role: UserRole) => void;
  clear: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  token: null,
  eventId: null,
  role: "runner",
  setSession: (next) =>
    set({
      token: next.token,
      eventId: next.eventId,
      role: next.role,
    }),
  setRole: (role) => set({ role }),
  clear: () => set({ token: null, eventId: null, role: "runner" }),
}));
