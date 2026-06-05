import { create } from "zustand";
import { apiFetch } from "../ui/api-client";
import { useSessionStore } from "./session-store";

export interface RosterMedic {
  id: string;
  name: string;
  unit?: string;
  vehicle?: string;
  type?: "coordinator" | "paramedic" | "medic";
  skills?: string[];
  capabilities?: string[];
}

interface RosterState {
  medics: RosterMedic[];
  loaded: boolean;
  /** True when the current session's medic is a coordinator. */
  amCoordinator: boolean;
  load: () => Promise<void>;
  getById: (id: string) => RosterMedic | undefined;
}

export const useRosterStore = create<RosterState>((set, get) => ({
  medics: [],
  loaded: false,
  amCoordinator: false,

  load: async () => {
    const eventId = useSessionStore.getState().eventId;
    const myId = useSessionStore.getState().userId;
    if (!eventId) return;
    try {
      const medics = await apiFetch<RosterMedic[]>(`/events/${eventId}/medics`);
      const me = medics.find((m) => m.id === myId);
      set({ medics, loaded: true, amCoordinator: me?.type === "coordinator" });
    } catch {
      // non-critical — leave previous roster in place
    }
  },

  getById: (id) => get().medics.find((m) => m.id === id),
}));
