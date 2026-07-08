import { create } from "zustand";
import type { Hospital } from "@events/contracts";
import { listHospitals } from "./hospitals-api";

interface HospitalsState {
  hospitals: Hospital[] | null;
  loading: boolean;
  error: string | null;
  /** Load-once (subsequent calls are no-ops unless the first one failed). */
  load: () => Promise<void>;
}

/**
 * Shared hospitals directory: the drawer list and the map pins both read from
 * here so the directory is fetched exactly once per session.
 */
export const useHospitalsStore = create<HospitalsState>((set, get) => ({
  hospitals: null,
  loading: false,
  error: null,

  load: async () => {
    if (get().hospitals !== null || get().loading) return;
    set({ loading: true, error: null });
    try {
      const hospitals = await listHospitals();
      set({ hospitals: hospitals ?? [], loading: false });
    } catch {
      set({ error: "Couldn't load hospitals — check your connection.", loading: false });
    }
  },
}));
