import { create } from "zustand";
import { debugLog } from "../debug/debug-log";
import { requestRoute } from "./routing-api";
import {
  bearingDegrees,
  distanceMeters,
  geometryLengthMeters,
  snapToPolyline,
  toLatLng,
} from "./geo";
import type {
  LatLng,
  LngLat,
  RouteInstruction,
  RouteProfile,
  RouteVariant,
  SurfaceClass,
  Waypoint,
} from "./types";

export type NavPhase = "idle" | "transport" | "variants" | "editing" | "active";

/** Live, derived navigation progress recomputed on every GPS fix. */
export interface NavProgress {
  /** Distance travelled along the active route, metres. */
  alongMeters: number;
  remainingMeters: number;
  remainingMs: number;
  /** Distance to the next maneuver point, metres. */
  toManeuverMeters: number;
  instructionIndex: number;
  /** True when the user has strayed far from the route line. */
  offRoute: boolean;
  /** Bearing the camera should face (route heading), degrees. */
  bearing: number;
  /** Ground speed in m/s (from successive fixes), or null until known. */
  speedMps: number | null;
  surface: SurfaceClass;
  /** Snapped position on the route — what the puck renders at. */
  snapped: LatLng;
}

interface NavState {
  phase: NavPhase;
  destination: (LatLng & { label: string }) | null;
  /** Set when navigating to an incident — broadcast on the route so others see
   *  the medic as responding (flashing), not just heading to a point. */
  destinationIncidentId: string | null;
  origin: LatLng | null;
  profile: RouteProfile | null;
  /** Inserted via-points (route editing), in order between start and dest. */
  vias: Array<LatLng & { label: string }>;
  routes: RouteVariant[];
  selectedRouteId: string | null;
  loading: boolean;
  error: string | null;
  /** When adding a point: insert after this index in the waypoint list. */
  pendingInsertIndex: number | null;
  progress: NavProgress | null;
  /** Guards against stale async route responses overwriting newer ones. */
  requestSeq: number;
  /** Last fix used for speed estimation. */
  lastFix: { lat: number; lng: number; at: number } | null;
  /** Active-nav camera orientation: travel-direction follow, or north-up. */
  navCameraMode: "follow" | "north";
  /** Bumped to force the nav camera to re-center even if nothing else changed. */
  recenterTick: number;
  /** Zoom the user pinched to during active nav — keeps location updates from
   *  snapping the camera back to the default nav zoom. Null = default. */
  navZoomOverride: number | null;
  /** "Avoid incoming traffic": route off the live race course where possible. */
  avoidIncomingTraffic: boolean;

  openTransport: (destination: LatLng & { label: string }, incidentId?: string | null) => void;
  cancel: () => void;
  selectProfile: (profile: RouteProfile, origin: LatLng) => Promise<void>;
  selectRoute: (id: string) => void;
  startEditing: () => void;
  beginInsert: (afterIndex: number) => void;
  cancelInsert: () => void;
  placePoint: (point: LatLng) => Promise<void>;
  removeWaypoint: (index: number) => Promise<void>;
  recalculate: () => Promise<void>;
  startNavigation: () => void;
  updateProgress: (fix: { lat: number; lng: number; at?: number }) => void;
  /** Compass press while navigating: re-center, toggling follow ↔ north-up. */
  toggleNavCamera: () => void;
  setNavZoomOverride: (zoom: number | null) => void;
  setAvoidIncomingTraffic: (value: boolean) => void;
  stop: () => void;
}

const OFF_ROUTE_THRESHOLD_M = 45;

export const useNavStore = create<NavState>((set, get) => ({
  phase: "idle",
  destination: null,
  origin: null,
  profile: null,
  vias: [],
  routes: [],
  selectedRouteId: null,
  loading: false,
  error: null,
  pendingInsertIndex: null,
  progress: null,
  requestSeq: 0,
  lastFix: null,
  navCameraMode: "follow",
  recenterTick: 0,
  navZoomOverride: null,
  avoidIncomingTraffic: false,
  destinationIncidentId: null,

  openTransport: (destination, incidentId = null) =>
    set({
      phase: "transport",
      destination,
      destinationIncidentId: incidentId,
      origin: null,
      profile: null,
      vias: [],
      routes: [],
      selectedRouteId: null,
      error: null,
      progress: null,
      pendingInsertIndex: null,
    }),

  cancel: () =>
    set({
      phase: "idle",
      destination: null,
      destinationIncidentId: null,
      origin: null,
      profile: null,
      vias: [],
      routes: [],
      selectedRouteId: null,
      error: null,
      loading: false,
      progress: null,
      pendingInsertIndex: null,
      lastFix: null,
      navZoomOverride: null,
    }),

  selectProfile: async (profile, origin) => {
    set({ profile, origin, phase: "variants" });
    await get().recalculate();
  },

  selectRoute: (id) => set({ selectedRouteId: id }),

  startEditing: () => {
    if (!get().selectedRouteId && get().routes[0]) {
      set({ selectedRouteId: get().routes[0].id });
    }
    set({ phase: "editing", pendingInsertIndex: null });
  },

  beginInsert: (afterIndex) => set({ pendingInsertIndex: afterIndex }),
  cancelInsert: () => set({ pendingInsertIndex: null }),

  placePoint: async (point) => {
    const { pendingInsertIndex, vias } = get();
    if (pendingInsertIndex === null) return;
    // The full waypoint list is [start, ...vias, dest]; via array index is the
    // insert position offset by the leading start row.
    const viaInsertIndex = Math.max(0, Math.min(vias.length, pendingInsertIndex));
    const nextVias = [...vias];
    nextVias.splice(viaInsertIndex, 0, { ...point, label: `Point ${viaInsertIndex + 2}` });
    set({ vias: nextVias, pendingInsertIndex: null });
    await get().recalculate();
  },

  removeWaypoint: async (index) => {
    // index is into the full list; only via rows (1..vias.length) are removable.
    const viaIndex = index - 1;
    const { vias } = get();
    if (viaIndex < 0 || viaIndex >= vias.length) return;
    const nextVias = vias.filter((_, i) => i !== viaIndex);
    set({ vias: nextVias });
    await get().recalculate();
  },

  recalculate: async () => {
    const { origin, destination, profile, vias } = get();
    if (!origin || !destination || !profile) return;
    const seq = get().requestSeq + 1;
    set({ requestSeq: seq, loading: true, error: null });

    const points: LngLat[] = [
      [origin.lng, origin.lat],
      ...vias.map((v): LngLat => [v.lng, v.lat]),
      [destination.lng, destination.lat],
    ];
    // Only 2-point routes ask for alternatives; via-routes return a single line.
    const alternatives = vias.length === 0 ? 3 : 1;

    try {
      const response = await requestRoute(profile, points, alternatives, get().avoidIncomingTraffic);
      if (get().requestSeq !== seq) return; // superseded by a newer request
      const selected =
        get().selectedRouteId && response.routes.some((r) => r.id === get().selectedRouteId)
          ? get().selectedRouteId
          : (response.routes[0]?.id ?? null);
      set({ routes: response.routes, selectedRouteId: selected, loading: false });
    } catch (err) {
      if (get().requestSeq !== seq) return;
      debugLog("api", "error", "route request failed", String(err));
      set({ loading: false, error: "Could not compute a route. Check routing service.", routes: [] });
    }
  },

  startNavigation: () => {
    if (!get().selectedRouteId && get().routes[0]) {
      set({ selectedRouteId: get().routes[0].id });
    }
    set({
      phase: "active",
      pendingInsertIndex: null,
      progress: null,
      lastFix: null,
      navCameraMode: "follow",
      navZoomOverride: null,
      recenterTick: get().recenterTick + 1,
    });
  },

  // Re-centering deliberately also resets a pinched zoom back to the default.
  toggleNavCamera: () =>
    set((s) => ({
      navCameraMode: s.navCameraMode === "follow" ? "north" : "follow",
      navZoomOverride: null,
      recenterTick: s.recenterTick + 1,
    })),

  setNavZoomOverride: (navZoomOverride) => set({ navZoomOverride }),

  setAvoidIncomingTraffic: (value) => {
    if (get().avoidIncomingTraffic === value) return;
    set({ avoidIncomingTraffic: value });
    // Re-run the current route with/without corridor avoidance if we have one.
    if (get().origin && get().destination && get().profile) void get().recalculate();
  },

  updateProgress: (fix) => {
    const state = get();
    const route = state.routes.find((r) => r.id === state.selectedRouteId);
    if (!route || route.geometry.length < 2) return;

    const here: LatLng = { lat: fix.lat, lng: fix.lng };
    const snap = snapToPolyline(here, route.geometry);
    if (!snap) return;

    const total = geometryLengthMeters(route.geometry);
    const remainingMeters = Math.max(0, total - snap.alongMeters);
    const fraction = total > 0 ? remainingMeters / total : 0;
    const remainingMs = route.durationMs * fraction;

    // Next maneuver: first instruction whose interval starts past our position.
    const { index, toManeuverMeters, instruction } = nextInstruction(route.instructions, route.geometry, snap.alongMeters);

    // Camera bearing = direction of the route a little ahead of the snap point.
    const aheadIndex = Math.min(route.geometry.length - 1, snap.segmentIndex + 1);
    const bearing = bearingDegrees(toLatLng(route.geometry[snap.segmentIndex]), toLatLng(route.geometry[aheadIndex]));

    // Speed from successive fixes.
    const now = fix.at ?? Date.now();
    let speedMps: number | null = state.progress?.speedMps ?? null;
    if (state.lastFix) {
      const dt = (now - state.lastFix.at) / 1000;
      if (dt > 0.5) {
        const moved = distanceMeters(here, { lat: state.lastFix.lat, lng: state.lastFix.lng });
        const instant = moved / dt;
        speedMps = speedMps === null ? instant : speedMps * 0.6 + instant * 0.4; // smooth
      }
    }

    const surface = surfaceAtAlong(route, snap.alongMeters);

    set({
      lastFix: { lat: fix.lat, lng: fix.lng, at: now },
      progress: {
        alongMeters: snap.alongMeters,
        remainingMeters,
        remainingMs,
        toManeuverMeters,
        instructionIndex: index,
        offRoute: snap.distanceMeters > OFF_ROUTE_THRESHOLD_M,
        bearing,
        speedMps,
        surface,
        snapped: snap.point,
      },
    });

    void instruction; // (kept for future re-route triggers)
  },

  stop: () => get().cancel(),
}));

/**
 * Build the full ordered waypoint list for the editing UI + markers.
 *
 * Pure helper over the raw pieces — call it inside a `useMemo` keyed on
 * origin/destination/vias rather than as a zustand selector, since it allocates
 * a fresh array each call (an unstable selector snapshot loops under zustand v5).
 */
export function buildWaypoints(
  origin: NavState["origin"],
  destination: NavState["destination"],
  vias: NavState["vias"],
): Waypoint[] {
  if (!origin || !destination) return [];
  return [
    { ...origin, kind: "start", label: "Start" },
    ...vias.map((v): Waypoint => ({ ...v, kind: "via", label: v.label })),
    { ...destination, kind: "dest", label: destination.label },
  ];
}

/** Cumulative metres at each route vertex. */
function cumulativeAlong(geometry: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < geometry.length; i += 1) {
    out.push(out[i - 1] + distanceMeters(toLatLng(geometry[i - 1]), toLatLng(geometry[i])));
  }
  return out;
}

function nextInstruction(
  instructions: RouteInstruction[],
  geometry: LngLat[],
  alongMeters: number,
): { index: number; toManeuverMeters: number; instruction: RouteInstruction | null } {
  if (instructions.length === 0) {
    return { index: 0, toManeuverMeters: 0, instruction: null };
  }
  const cum = cumulativeAlong(geometry);
  for (let i = 0; i < instructions.length; i += 1) {
    const endIndex = Math.min(geometry.length - 1, instructions[i].interval[1]);
    const maneuverAlong = cum[endIndex] ?? 0;
    if (maneuverAlong > alongMeters + 1) {
      return { index: i, toManeuverMeters: maneuverAlong - alongMeters, instruction: instructions[i] };
    }
  }
  const last = instructions[instructions.length - 1];
  const lastAlong = cum[cum.length - 1] ?? 0;
  return { index: instructions.length - 1, toManeuverMeters: Math.max(0, lastAlong - alongMeters), instruction: last };
}

function surfaceAtAlong(route: RouteVariant, alongMeters: number): SurfaceClass {
  let acc = 0;
  for (const segment of route.segments) {
    acc += geometryLengthMeters(segment.coordinates);
    if (alongMeters <= acc) return segment.surface;
  }
  return route.segments[route.segments.length - 1]?.surface ?? "road";
}
