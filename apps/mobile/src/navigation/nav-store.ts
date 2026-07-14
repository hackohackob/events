import { create } from "zustand";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { debugLog } from "../debug/debug-log";
import { createAnnouncer, type SpokenInstruction } from "../tracknav/announcer";
import { maneuverLabel } from "./surface";
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
  /** Snapped position on the route — used for the path-clip / progress. */
  snapped: LatLng;
  /** The real GPS position. The puck renders here when off-route, else snapped. */
  raw: LatLng;
  /** Perpendicular distance from the route line, metres. */
  offRouteMeters: number;
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
  /** Wall-clock ms when the user first went off-route (null while on-route). */
  offRouteSince: number | null;
  /** Last auto-reroute time, to rate-limit re-routing. */
  lastRerouteAt: number;
  /** True while an off-route auto-reroute request is in flight. */
  rerouting: boolean;
  /** Voice turn announcements muted for this session. */
  voiceMuted: boolean;

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
  /** Recompute the route from a new origin (off-route auto-reroute). */
  reroute: (from: LatLng) => Promise<void>;
  startNavigation: () => void;
  updateProgress: (fix: { lat: number; lng: number; at?: number }) => void;
  /** Compass press while navigating: re-center, toggling follow ↔ north-up. */
  toggleNavCamera: () => void;
  setNavZoomOverride: (zoom: number | null) => void;
  setAvoidIncomingTraffic: (value: boolean) => void;
  toggleVoiceMuted: () => void;
  stop: () => void;
}

// Past this perpendicular distance from the route the puck shows the real GPS
// position (not the snap) and the "return to path" prompt flashes.
const OFF_ROUTE_THRESHOLD_M = 30;
// How long continuously off-route before a fresh route is computed from the
// user's actual position, and the minimum gap between auto-reroutes.
const REROUTE_AFTER_MS = 12_000;
const REROUTE_COOLDOWN_MS = 15_000;

const KEEP_AWAKE_TAG = "point-navigation";

// Voice turn announcements for point-to-point navigation — same engine as
// track-following (tracknav starts cancel this store and vice versa, so the
// two announcers can never talk over each other).
const announcer = createAnnouncer();

// Spoken guidance deliberately drops GraphHopper's street names ("Turn left
// onto бул. Витоша" reads terribly in the en-US voice) — the voice sticks to
// the maneuver itself; the banner still shows the street. Cached per
// instruction array so the mapping doesn't re-allocate on every 1Hz GPS fix.
const spokenCache = new WeakMap<RouteInstruction[], SpokenInstruction[]>();
function spokenInstructions(instructions: RouteInstruction[]): SpokenInstruction[] {
  const cached = spokenCache.get(instructions);
  if (cached) return cached;
  const out = instructions.map((inst): SpokenInstruction => ({
    maneuver: inst.maneuver,
    text: inst.maneuver === "arrive" ? "You have arrived at your destination" : maneuverLabel(inst.maneuver),
  }));
  spokenCache.set(instructions, out);
  return out;
}

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
  offRouteSince: null,
  lastRerouteAt: 0,
  rerouting: false,
  voiceMuted: false,
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

  cancel: () => {
    if (get().phase === "active") {
      announcer.reset();
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    }
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
      offRouteSince: null,
      rerouting: false,
    });
  },

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

  reroute: async (from) => {
    const { destination, profile } = get();
    if (!destination || !profile) return;
    debugLog("location", "info", "off-route — recomputing navigation path", { from });
    // Fresh route from the user's actual position; drop any prior via-points.
    set({ origin: from, vias: [], offRouteSince: null, rerouting: true });
    try {
      await get().recalculate();
      if (get().phase === "active" && !get().error) announcer.rerouted();
    } finally {
      set({ rerouting: false });
    }
  },

  startNavigation: () => {
    if (!get().selectedRouteId && get().routes[0]) {
      set({ selectedRouteId: get().routes[0].id });
    }
    // Keep the screen lit for the whole navigation session.
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    const route = get().routes.find((r) => r.id === get().selectedRouteId);
    announcer.reset();
    announcer.setMuted(get().voiceMuted);
    announcer.start(
      get().destination?.label ?? "destination",
      route?.distanceMeters ?? 0,
      "Navigating to",
    );
    set({
      phase: "active",
      pendingInsertIndex: null,
      progress: null,
      lastFix: null,
      navCameraMode: "follow",
      navZoomOverride: null,
      recenterTick: get().recenterTick + 1,
      offRouteSince: null,
      lastRerouteAt: 0,
      rerouting: false,
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

  toggleVoiceMuted: () => {
    const voiceMuted = !get().voiceMuted;
    announcer.setMuted(voiceMuted);
    set({ voiceMuted });
  },

  updateProgress: (fix) => {
    const state = get();
    const route = state.routes.find((r) => r.id === state.selectedRouteId);
    if (!route || route.geometry.length < 2) return;

    // Drop stale / out-of-order fixes. When the screen locks, the OS buffers GPS
    // updates and replays the whole backlog on unlock; with real fix timestamps
    // those are all older than what we've already processed, so we skip them and
    // keep only the newest — no second-by-second catch-up animation.
    const fixAt = fix.at ?? Date.now();
    if (state.lastFix && fixAt <= state.lastFix.at) return;

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
    const now = fixAt;
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

    const offRoute = snap.distanceMeters > OFF_ROUTE_THRESHOLD_M;
    // Track how long we've been off-route so we can recompute a fresh path.
    const offRouteSince = offRoute ? (state.offRouteSince ?? now) : null;

    // Spoken turn guidance (only while actually navigating).
    if (state.phase === "active") {
      if (offRoute) {
        announcer.offTrack(snap.distanceMeters);
      } else {
        announcer.backOnTrack();
        announcer.onProgress({
          toManeuverMeters,
          instructionIndex: index,
          instructions: spokenInstructions(route.instructions),
          remainingMeters,
          speedMps,
          atMs: now,
        });
      }
    }

    set({
      lastFix: { lat: fix.lat, lng: fix.lng, at: now },
      offRouteSince,
      progress: {
        alongMeters: snap.alongMeters,
        remainingMeters,
        remainingMs,
        toManeuverMeters,
        instructionIndex: index,
        offRoute,
        bearing,
        speedMps,
        surface,
        snapped: snap.point,
        raw: here,
        offRouteMeters: snap.distanceMeters,
      },
    });

    // After a sustained spell off the line, recompute navigation from where the
    // user actually is (rate-limited so it can't thrash).
    if (
      offRoute &&
      offRouteSince &&
      now - offRouteSince > REROUTE_AFTER_MS &&
      !state.loading &&
      !state.rerouting &&
      now - state.lastRerouteAt > REROUTE_COOLDOWN_MS
    ) {
      set({ lastRerouteAt: now });
      void get().reroute(here);
    }

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

/** Cumulative metres at each route vertex — cached per geometry, recomputing
 *  an O(n) array on every 1Hz GPS fix was wasted work. */
const cumulativeCache = new WeakMap<LngLat[], number[]>();
function cumulativeAlong(geometry: LngLat[]): number[] {
  const cached = cumulativeCache.get(geometry);
  if (cached) return cached;
  const out = [0];
  for (let i = 1; i < geometry.length; i += 1) {
    out.push(out[i - 1] + distanceMeters(toLatLng(geometry[i - 1]), toLatLng(geometry[i])));
  }
  cumulativeCache.set(geometry, out);
  return out;
}

/**
 * The UPCOMING maneuver for a position along the route.
 *
 * GraphHopper semantics: instruction `i`'s turn happens at the START of its
 * interval (`interval[0]`, also exposed as `location`), and the interval spans
 * the leg you drive AFTER making that turn. So while traversing instruction
 * i's leg, the next turn to show/speak is instruction i+1, located at
 * `interval[i+1][0]`. This used to match against `interval[1]` and return the
 * CURRENT leg's instruction — the distance (and the map arrows, drawn at each
 * instruction's location) pointed at the next turn while the banner text and
 * the voice announced the turn already behind you.
 */
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
    const startIndex = Math.min(geometry.length - 1, instructions[i].interval[0]);
    const maneuverAlong = cum[startIndex] ?? 0;
    if (maneuverAlong > alongMeters + 1) {
      return { index: i, toManeuverMeters: maneuverAlong - alongMeters, instruction: instructions[i] };
    }
  }
  // Past the last turn point — stick with the final (arrive) instruction.
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
