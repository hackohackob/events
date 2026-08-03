import { create } from "zustand";
import { DEFAULT_VEHICLE_TYPE, type VehicleType } from "@events/contracts";
import { apiFetch } from "../ui/api-client";
import { useSessionStore } from "./session-store";

export interface RosterMedic {
  id: string;
  name: string;
  unit?: string;
  /** Free-text unit/position label. */
  vehicle?: string;
  /** What they travel with — drives every ETA quoted for this medic. */
  vehicleType: VehicleType;
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
  /** Patch one medic's vehicle locally (optimistic / realtime `medic.vehicle`). */
  setVehicleType: (medicId: string, vehicleType: VehicleType) => void;
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
      const raw = await apiFetch<RosterMedic[]>(`/events/${eventId}/medics`);
      // Older backends don't send vehicleType; never let it be undefined so the
      // pickers and ETA labels always have something to show.
      const medics = raw.map((m) => ({ ...m, vehicleType: m.vehicleType ?? DEFAULT_VEHICLE_TYPE }));
      const me = medics.find((m) => m.id === myId);
      set({ medics, loaded: true, amCoordinator: me?.type === "coordinator" });
    } catch {
      // non-critical — leave previous roster in place
    }
  },

  getById: (id) => get().medics.find((m) => m.id === id),

  setVehicleType: (medicId, vehicleType) =>
    set((state) => ({
      medics: state.medics.map((m) => (m.id === medicId ? { ...m, vehicleType } : m)),
    })),
}));
