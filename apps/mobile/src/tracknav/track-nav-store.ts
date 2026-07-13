import { create } from "zustand";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { debugLog } from "../debug/debug-log";
import { useNavStore } from "../navigation/nav-store";
import { useLocationStatus } from "../debug/location-status";
import { bearingDegrees, distanceMeters } from "../navigation/geo";
import type { LatLng } from "../navigation/types";
import { createAnnouncer } from "./announcer";
import { createMatcherState, initialAlong, matchFix, type MatcherState } from "./track-matcher";
import { prepareTrack, type PreparedTrack, type TrackInstruction } from "./turn-detection";

export type TrackNavPhase = "idle" | "active" | "paused";

const KEEP_AWAKE_TAG = "tracknav";
/** Speak the off-track warning only after this long continuously off the line. */
const OFF_TRACK_ANNOUNCE_AFTER_MS = 10_000;
/** The medic has arrived once within this much of the track end. */
const ARRIVE_WITHIN_M = 20;

export interface TrackNavProgress {
  alongMeters: number;
  totalMeters: number;
  remainingMeters: number;
  /** 0–1 fraction of the track covered. */
  fraction: number;
  toManeuverMeters: number;
  instructionIndex: number;
  offTrack: boolean;
  offTrackMeters: number;
  /** Closest point on the track while off it — drawn as the way back. */
  nearestPoint: LatLng | null;
  /** Camera/travel bearing (matched segment direction), degrees. */
  bearing: number;
  speedMps: number | null;
  snapped: LatLng;
  raw: LatLng;
}

export interface FollowableTrack {
  id: string;
  label: string;
  color?: string;
  points: Array<{ lat: number; lng: number; ele?: number }>;
}

interface TrackNavState {
  phase: TrackNavPhase;
  track: { id: string; label: string; color?: string } | null;
  prepared: PreparedTrack | null;
  /** Elevation per original track vertex (metres), when the GPX carried <ele>. */
  elevations: Array<number | undefined>;
  progress: TrackNavProgress | null;
  matcher: MatcherState | null;
  muted: boolean;
  arrived: boolean;
  /** Set right after an auto-detected loop skip; the overlay shows a toast. */
  loopSkip: { jumpMeters: number; atMs: number } | null;
  /** Set right after a wrong-leg direction correction; the overlay shows a toast. */
  legSwitch: { atMs: number } | null;
  lastFix: { lat: number; lng: number; at: number } | null;
  /** Camera orientation, mirroring the regular nav camera behaviour. */
  camMode: "follow" | "north";
  recenterTick: number;
  zoomOverride: number | null;

  start: (track: FollowableTrack) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  updateProgress: (fix: { lat: number; lng: number; at?: number; heading?: number | null }) => void;
  toggleMuted: () => void;
  toggleCamera: () => void;
  setZoomOverride: (zoom: number | null) => void;
  dismissLoopSkip: () => void;
  dismissLegSwitch: () => void;
}

const announcer = createAnnouncer();

function instructionAtAlong(
  instructions: TrackInstruction[],
  alongMeters: number,
): { index: number; toManeuverMeters: number } {
  for (let i = 0; i < instructions.length; i += 1) {
    if (instructions[i].alongMeters > alongMeters + 1) {
      return { index: i, toManeuverMeters: instructions[i].alongMeters - alongMeters };
    }
  }
  const last = instructions.length - 1;
  return {
    index: Math.max(0, last),
    toManeuverMeters: Math.max(0, (instructions[last]?.alongMeters ?? 0) - alongMeters),
  };
}

export const useTrackNavStore = create<TrackNavState>((set, get) => ({
  phase: "idle",
  track: null,
  prepared: null,
  elevations: [],
  progress: null,
  matcher: null,
  muted: false,
  arrived: false,
  loopSkip: null,
  legSwitch: null,
  lastFix: null,
  camMode: "follow",
  recenterTick: 0,
  zoomOverride: null,

  start: (track) => {
    if (track.points.length < 2) {
      debugLog("location", "error", "track too short to follow", { trackId: track.id });
      return;
    }
    // Mutual exclusion: following a track and point-to-point navigation can't
    // both drive the camera/voice. Starting one cancels the other (the reverse
    // direction is handled by the nav-store subscription below).
    useNavStore.getState().cancel();

    const prepared = prepareTrack(track.points.map((p) => [p.lng, p.lat]));
    // Start from wherever the medic is on the track (they often join mid-way).
    const fix = useLocationStatus.getState().lastFix;
    const startAlong = fix ? initialAlong({ lat: fix.lat, lng: fix.lng }, prepared) : 0;

    announcer.reset();
    announcer.setMuted(get().muted);
    announcer.start(track.label, prepared.totalMeters - startAlong);
    announcer.rearmAfterJump(startAlong, prepared.instructions);

    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    debugLog("location", "info", "track-following started", {
      trackId: track.id,
      totalMeters: Math.round(prepared.totalMeters),
      instructions: prepared.instructions.length,
      startAlong: Math.round(startAlong),
    });

    set({
      phase: "active",
      track: { id: track.id, label: track.label, color: track.color },
      prepared,
      elevations: track.points.map((p) => p.ele),
      matcher: createMatcherState(startAlong),
      progress: null,
      arrived: false,
      loopSkip: null,
      legSwitch: null,
      lastFix: null,
      camMode: "follow",
      recenterTick: get().recenterTick + 1,
      zoomOverride: null,
    });
  },

  stop: () => {
    if (get().phase === "idle") return;
    announcer.reset();
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    debugLog("location", "info", "track-following stopped", { trackId: get().track?.id });
    set({
      phase: "idle",
      track: null,
      prepared: null,
      elevations: [],
      progress: null,
      matcher: null,
      arrived: false,
      loopSkip: null,
      legSwitch: null,
      lastFix: null,
      zoomOverride: null,
    });
  },

  pause: () => {
    if (get().phase !== "active") return;
    announcer.paused();
    set({ phase: "paused" });
  },

  resume: () => {
    if (get().phase !== "paused") return;
    announcer.resumed();
    set({ phase: "active", recenterTick: get().recenterTick + 1 });
  },

  updateProgress: (fix) => {
    const state = get();
    const { prepared, matcher } = state;
    if ((state.phase !== "active" && state.phase !== "paused") || !prepared || !matcher) return;

    // Same stale-fix guard as the regular nav store: on unlock the OS replays
    // a backlog of buffered fixes; real timestamps let us skip the stale ones.
    const fixAt = fix.at ?? Date.now();
    if (state.lastFix && fixAt <= state.lastFix.at) return;

    const here: LatLng = { lat: fix.lat, lng: fix.lng };

    // Speed from successive fixes (EWMA-smoothed, like nav-store).
    let speedMps: number | null = state.progress?.speedMps ?? null;
    let movedBearing: number | null = null;
    if (state.lastFix) {
      const dt = (fixAt - state.lastFix.at) / 1000;
      if (dt > 0.5) {
        const moved = distanceMeters(here, { lat: state.lastFix.lat, lng: state.lastFix.lng });
        const instant = moved / dt;
        speedMps = speedMps === null ? instant : speedMps * 0.6 + instant * 0.4;
        if (moved > 2) {
          movedBearing = bearingDegrees({ lat: state.lastFix.lat, lng: state.lastFix.lng }, here);
        }
      }
    }
    // Device heading when moving fast enough to trust it; else fix-to-fix
    // bearing. Android reports -1 for "unknown heading" — treat it as absent,
    // otherwise the wrong-leg detector would compare against a bogus bearing.
    const headingDeg =
      fix.heading != null && Number.isFinite(fix.heading) && fix.heading >= 0 && (speedMps ?? 0) > 1
        ? fix.heading
        : movedBearing;

    const { state: nextMatcher, result } = matchFix(matcher, { ...here, headingDeg, atMs: fixAt }, prepared);

    if (result.status === "on") {
      const remainingMeters = Math.max(0, prepared.totalMeters - result.alongMeters);
      const { index, toManeuverMeters } = instructionAtAlong(prepared.instructions, result.alongMeters);
      const wasOffTrack = state.progress?.offTrack ?? false;

      if (result.loopSkipMeters !== null) {
        announcer.rearmAfterJump(result.alongMeters, prepared.instructions);
        if (state.phase === "active") announcer.loopSkipped(result.loopSkipMeters);
        debugLog("location", "info", "track loop skipped", {
          jumpMeters: Math.round(result.loopSkipMeters),
          alongMeters: Math.round(result.alongMeters),
        });
      } else if (result.legSwitchMeters !== null) {
        // Wrong-leg correction (out-and-back): progress jumped onto the leg
        // that agrees with the travel direction — re-arm voice cues around the
        // new position so old maneuvers aren't spoken.
        announcer.rearmAfterJump(result.alongMeters, prepared.instructions);
        if (state.phase === "active") announcer.directionCorrected();
        debugLog("location", "info", "track direction corrected (leg switch)", {
          jumpMeters: Math.round(result.legSwitchMeters),
          alongMeters: Math.round(result.alongMeters),
        });
      } else if (wasOffTrack && state.phase === "active") {
        announcer.backOnTrack();
      }

      const arrived = state.arrived || remainingMeters <= ARRIVE_WITHIN_M;
      if (state.phase === "active") {
        announcer.onProgress({
          toManeuverMeters,
          instructionIndex: index,
          instructions: prepared.instructions,
          remainingMeters,
          speedMps,
          atMs: fixAt,
        });
      }

      set({
        matcher: nextMatcher,
        lastFix: { lat: fix.lat, lng: fix.lng, at: fixAt },
        arrived,
        loopSkip: result.loopSkipMeters !== null ? { jumpMeters: result.loopSkipMeters, atMs: fixAt } : state.loopSkip,
        legSwitch: result.legSwitchMeters !== null ? { atMs: fixAt } : state.legSwitch,
        progress: {
          alongMeters: result.alongMeters,
          totalMeters: prepared.totalMeters,
          remainingMeters,
          fraction: prepared.totalMeters > 0 ? result.alongMeters / prepared.totalMeters : 0,
          toManeuverMeters,
          instructionIndex: index,
          offTrack: false,
          offTrackMeters: result.perpMeters,
          nearestPoint: null,
          bearing: result.segmentBearing,
          speedMps,
          snapped: result.snapped,
          raw: here,
        },
      });
      return;
    }

    // Off-track: progress holds at the last committed position; the overlay
    // shows the distance back and the map draws a dashed line to the track.
    if (
      state.phase === "active" &&
      fixAt - result.offTrackSinceMs >= OFF_TRACK_ANNOUNCE_AFTER_MS
    ) {
      announcer.offTrack(result.distanceBackMeters);
    }

    const remainingMeters = Math.max(0, prepared.totalMeters - result.alongMeters);
    const { index, toManeuverMeters } = instructionAtAlong(prepared.instructions, result.alongMeters);
    set({
      matcher: nextMatcher,
      lastFix: { lat: fix.lat, lng: fix.lng, at: fixAt },
      progress: {
        alongMeters: result.alongMeters,
        totalMeters: prepared.totalMeters,
        remainingMeters,
        fraction: prepared.totalMeters > 0 ? result.alongMeters / prepared.totalMeters : 0,
        toManeuverMeters,
        instructionIndex: index,
        offTrack: true,
        offTrackMeters: result.distanceBackMeters,
        nearestPoint: result.nearestPoint,
        bearing: state.progress?.bearing ?? (headingDeg ?? 0),
        speedMps,
        snapped: result.nearestPoint,
        raw: here,
      },
    });
  },

  toggleMuted: () => {
    const muted = !get().muted;
    announcer.setMuted(muted);
    set({ muted });
  },

  // Re-centering deliberately also resets a pinched zoom (matches regular nav).
  toggleCamera: () =>
    set((s) => ({
      camMode: s.camMode === "follow" ? "north" : "follow",
      zoomOverride: null,
      recenterTick: s.recenterTick + 1,
    })),

  setZoomOverride: (zoomOverride) => set({ zoomOverride }),

  dismissLoopSkip: () => set({ loopSkip: null }),

  dismissLegSwitch: () => set({ legSwitch: null }),
}));

// Reverse mutual exclusion: any regular navigation start (transport sheet,
// radial menu, incident dispatch, …) shuts down track-following. tracknav's
// own start() calls nav cancel() FIRST and only then flips its phase, so this
// subscription never fires for that transition.
useNavStore.subscribe((navState) => {
  if (navState.phase !== "idle" && useTrackNavStore.getState().phase !== "idle") {
    useTrackNavStore.getState().stop();
  }
});
