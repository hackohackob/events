import { create } from "zustand";
import { smoothZonePolygon, type Ring } from "./zone-geometry";

/**
 * Freehand zone drawing state. Lives in a tiny store because the touch capture
 * overlay sits OUTSIDE the map while the live sketch preview renders INSIDE it
 * (as a GeoJSON layer) — the two just share this.
 */
interface ZoneDrawState {
  phase: "idle" | "draw" | "name";
  /** Raw [lng, lat] trail while the finger is down. */
  sketch: Ring;
  /** Smoothed ring awaiting a name/color once the finger lifts. */
  pending: Ring | null;
  start: () => void;
  resetSketch: () => void;
  appendSketch: (points: Ring) => void;
  /** Finger lifted: smooth the trail → naming step (or back to draw if tiny). */
  finishSketch: () => void;
  cancel: () => void;
}

export const useZoneDrawStore = create<ZoneDrawState>((set, get) => ({
  phase: "idle",
  sketch: [],
  pending: null,

  start: () => set({ phase: "draw", sketch: [], pending: null }),
  resetSketch: () => set({ sketch: [] }),
  appendSketch: (points) => set({ sketch: [...get().sketch, ...points] }),

  finishSketch: () => {
    const polygon = smoothZonePolygon(get().sketch);
    if (polygon.length < 3) {
      set({ sketch: [] });
      return;
    }
    set({ phase: "name", pending: polygon, sketch: [] });
  },

  cancel: () => set({ phase: "idle", sketch: [], pending: null }),
}));
