import { create } from "zustand";
import type { EventZone } from "@events/contracts";
import { fetchZones } from "./zone-api";
import { debugLog } from "../../debug/debug-log";

interface ZonesState {
  zones: EventZone[];
  load: () => Promise<void>;
  upsert: (zone: EventZone) => void;
  remove: (zoneId: string) => void;
  clear: () => void;
}

/** Team zones (medic-only). Filled by an initial fetch + zone.* socket events. */
export const useZonesStore = create<ZonesState>((set, get) => ({
  zones: [],

  load: async () => {
    try {
      const zones = await fetchZones();
      set({ zones: Array.isArray(zones) ? zones : [] });
    } catch (err) {
      // Runners get a 403 by design; anything else is worth a debug line.
      debugLog("api", "warn", "zones fetch failed", String(err));
    }
  },

  upsert: (zone) => {
    const zones = get().zones;
    const index = zones.findIndex((z) => z.id === zone.id);
    set({
      zones: index === -1 ? [...zones, zone] : zones.map((z) => (z.id === zone.id ? zone : z)),
    });
  },

  remove: (zoneId) => set({ zones: get().zones.filter((z) => z.id !== zoneId) }),

  clear: () => set({ zones: [] }),
}));
