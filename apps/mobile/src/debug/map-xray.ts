import { create } from "zustand";

/**
 * Map x-ray — a field bisect for "the map will not pan on my phone".
 *
 * We know the touch reaches the app, we know an isolated MapLibre map pans and
 * zooms on the affected device, and we know the Debug tab (which hosts that
 * isolated map) renders inside this very screen. What is left is that one of
 * MapScreen's ~25 sibling overlays is sitting over the real map and swallowing
 * the gesture on that device.
 *
 * Rather than unmount overlays one at a time — twenty-five edits in a 7000-line
 * file, on the screen medics depend on — this raises the MAP's own zIndex in
 * steps. Android hit-tests in zIndex order, so each step lifts the map above
 * one more band of overlays. Whichever step makes the map start moving names
 * the band the culprit is in:
 *
 *   1 → above every sibling with no zIndex at all (the bottom sheets, the
 *       trail transport, the exit-point preview: they sit later in the tree,
 *       so they paint over the map today)
 *   2 → also above missionStrip (20) and topHeader (21)
 *   3 → also above offlineButtonWrap (25) and MedicStatusControl (30)
 *   4 → also above IncidentFAB and AssignedIncidentBanner (35)
 *   5 → above everything: menuBackdrop / tabOverlay (40) and SearchOverlay (60)
 *
 * Level 0 is off and is the only state that ships behaviour: MapScreen passes
 * its usual style object untouched, so a device with the x-ray off runs exactly
 * the code it ran before this existed.
 */

/** zIndex the map is given at each level. Index 0 (off) is never applied. */
export const XRAY_Z = [0, 1, 22, 31, 36, 61] as const;

export const XRAY_MAX = XRAY_Z.length - 1;

interface MapXrayState {
  level: number;
  setLevel: (level: number) => void;
  /** Cycles 0 → 1 → … → 5 → 0, for the on-screen escape chip. */
  cycle: () => void;
}

export const useMapXray = create<MapXrayState>((set) => ({
  level: 0,
  setLevel: (level) => set({ level: Math.max(0, Math.min(XRAY_MAX, level)) }),
  cycle: () => set((s) => ({ level: s.level >= XRAY_MAX ? 0 : s.level + 1 })),
}));
