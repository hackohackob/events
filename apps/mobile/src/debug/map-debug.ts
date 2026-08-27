import { create } from "zustand";

/**
 * Live control over MapScreen's overlay stack.
 *
 * Built for one job: the map will not pan on a particular phone, while an
 * isolated MapLibre map on the same device pans and zooms perfectly. That means
 * one of the ~30 views layered over the map is swallowing the gesture there —
 * and the only person who can find out which is the person holding that phone.
 *
 * So the bisect ships to her: turn overlays off one at a time until the map
 * starts moving, and the last one switched off is the culprit. Nothing here is
 * persisted; every setting is back to normal on the next app start, so a medic
 * cannot permanently break their own map with it.
 */

export interface MapElement {
  id: string;
  label: string;
  /** What it looks like on screen, for someone who has never read the code. */
  hint: string;
  group: string;
}

export const MAP_ELEMENT_GROUPS = ["Chrome", "Drawers", "Navigation", "Popups", "Map extras"] as const;

export const MAP_ELEMENTS: MapElement[] = [
  { id: "topHeader", label: "Top header", hint: "Menu button and the action column", group: "Chrome" },
  { id: "bottomMenu", label: "Bottom tab bar", hint: "Map / Tracks / Chat", group: "Chrome" },
  { id: "medicStatus", label: "Status control", hint: "Your on-duty status pill", group: "Chrome" },
  { id: "incidentFab", label: "Report button", hint: "The red incident button", group: "Chrome" },
  { id: "trailPanel", label: "History transport", hint: "Location-history player", group: "Chrome" },
  { id: "scaleBar", label: "Scale bar", hint: "Distance ruler, bottom left", group: "Chrome" },
  { id: "offlineBadge", label: "Offline badge", hint: "Unsent-reports pill", group: "Chrome" },

  { id: "trackSheet", label: "Track studio", hint: "Tracks drawer", group: "Drawers" },
  { id: "markerSheet", label: "Marker details", hint: "Drawer for a tapped pin", group: "Drawers" },
  { id: "participantsSheet", label: "Participants", hint: "Roster drawer", group: "Drawers" },
  { id: "hospitalsSheet", label: "Hospitals", hint: "Hospitals drawer", group: "Drawers" },
  { id: "reportSheet", label: "Report incident", hint: "New-report sheet", group: "Drawers" },
  { id: "pendingSheet", label: "Pending incidents", hint: "Unsent reports sheet", group: "Drawers" },
  { id: "newPoiSheet", label: "New point", hint: "Add-a-point sheet", group: "Drawers" },
  { id: "editPoiSheet", label: "Edit point", hint: "Edit-a-point sheet", group: "Drawers" },

  { id: "searchOverlay", label: "Search", hint: "Places and bib search", group: "Navigation" },
  { id: "navRadial", label: "Radial menu", hint: "Long-press ring on the map", group: "Navigation" },
  { id: "assignedBanner", label: "Assigned banner", hint: "Your assigned incident", group: "Navigation" },
  { id: "transportSheet", label: "Transport", hint: "Vehicle picker", group: "Navigation" },
  { id: "routeVariants", label: "Route variants", hint: "Alternative routes", group: "Navigation" },
  { id: "routeEditHelper", label: "Route edit hint", hint: "Editing banner", group: "Navigation" },
  { id: "routeEditingSheet", label: "Route editing", hint: "Editing sheet", group: "Navigation" },
  { id: "activeNav", label: "Navigation HUD", hint: "Turn-by-turn overlay", group: "Navigation" },
  { id: "trackNav", label: "Track nav HUD", hint: "Track-following overlay", group: "Navigation" },

  { id: "menuPopup", label: "Menu popup", hint: "The Menu list", group: "Popups" },
  { id: "layersPopup", label: "Layers popup", hint: "Layers and tracks list", group: "Popups" },
  { id: "menuBackdrop", label: "Popup backdrop", hint: "Dimmer behind a popup", group: "Popups" },
  { id: "photoViewer", label: "Photo viewer", hint: "Full-screen photo", group: "Popups" },

  { id: "exitPreview", label: "Exit point card", hint: "Closest-asphalt card", group: "Map extras" },
  { id: "moveHelpers", label: "Move helpers", hint: "Banner while moving a pin", group: "Map extras" },
  { id: "zoneDraw", label: "Zone drawing", hint: "Freehand zone catcher", group: "Map extras" },
];

/**
 * zIndex presets for the map itself. Android hit-tests in zIndex order, so
 * raising the map lifts it over a band of overlays without hiding anything —
 * the fast way to prove the problem IS an overlay before hunting the exact one.
 */
export const MAP_Z_PRESETS = [
  { value: 0, label: "Default", hint: "map underneath everything" },
  { value: 1, label: "1", hint: "over the drawers" },
  { value: 22, label: "22", hint: "over the top header" },
  { value: 31, label: "31", hint: "over the status control" },
  { value: 36, label: "36", hint: "over the report button" },
  { value: 61, label: "Top", hint: "over absolutely everything" },
] as const;

interface MapDebugState {
  hidden: Record<string, boolean>;
  mapZIndex: number;
  toggle: (id: string) => void;
  setAllHidden: (hidden: boolean) => void;
  setMapZIndex: (zIndex: number) => void;
  reset: () => void;
}

export const useMapDebug = create<MapDebugState>((set) => ({
  hidden: {},
  mapZIndex: 0,
  toggle: (id) => set((s) => ({ hidden: { ...s.hidden, [id]: !s.hidden[id] } })),
  setAllHidden: (hidden) =>
    set({ hidden: hidden ? Object.fromEntries(MAP_ELEMENTS.map((e) => [e.id, true])) : {} }),
  setMapZIndex: (mapZIndex) => set({ mapZIndex }),
  reset: () => set({ hidden: {}, mapZIndex: 0 }),
}));

/** How far from stock the map currently is — drives the on-map escape chip. */
export function mapDebugDirtyCount(hidden: Record<string, boolean>, mapZIndex: number): number {
  return Object.values(hidden).filter(Boolean).length + (mapZIndex > 0 ? 1 : 0);
}
