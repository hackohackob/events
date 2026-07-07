/**
 * Pure position→track matcher for track-following navigation.
 *
 * Requirements it encodes:
 *  - Self-intersecting / out-and-back tracks must not make progress jump to
 *    the wrong pass: a local arc-length window, a backward-movement penalty
 *    and a heading-agreement penalty keep the match on the correct leg.
 *  - A medic may deliberately SKIP a loop (leave the track and rejoin past
 *    it): after a sustained off-track spell the matcher scans the whole
 *    geometry, prefers the furthest-forward plausible cluster, and commits
 *    once it's stable across several fixes — progress jumps ahead, no
 *    rerouting, and the caller is told a loop was skipped.
 *
 * Pure `(state, fix, track) → { state, result }`; unit-tested in isolation.
 */
import { bearingDegrees, toLatLng } from "../navigation/geo";
import type { LatLng, LngLat } from "../navigation/types";
import type { PreparedTrack } from "./turn-detection";
import { signedAngleDiff } from "./turn-detection";

export interface MatcherState {
  /** Committed arc-length position, metres. */
  lastAlong: number;
  /** Wall-clock ms when the fix stream first left the track (null while on it). */
  offTrackSinceMs: number | null;
  /** Global re-acquisition candidate being confirmed across consecutive fixes. */
  reacq: { candidateAlong: number; hits: number } | null;
}

export interface MatcherFix {
  lat: number;
  lng: number;
  /** Travel direction, degrees clockwise from north — null when unknown/stationary. */
  headingDeg: number | null;
  atMs: number;
}

export type MatchResult =
  | {
      status: "on";
      alongMeters: number;
      snapped: LatLng;
      perpMeters: number;
      /** Bearing of the matched track segment — drives the follow camera. */
      segmentBearing: number;
      /** Set when this commit was a forward jump past a skipped loop. */
      loopSkipMeters: number | null;
    }
  | {
      status: "off";
      /** Last committed along — progress display holds here while off-track. */
      alongMeters: number;
      distanceBackMeters: number;
      nearestPoint: LatLng;
      offTrackSinceMs: number;
    };

// Local window around the committed position (metres of arc-length).
const LOCAL_BACK_M = 150;
const LOCAL_AHEAD_M = 600;
// Candidate gates.
const LOCAL_MAX_PERP_M = 60;
const COMMIT_MAX_PERP_M = 35;
const BACKWARD_REJECT_M = 120;
// Score weights (all in metre-equivalents).
const BACKWARD_PENALTY_PER_M = 0.03;
const HEADING_PENALTY_PER_DEG = 0.4;
// Global re-acquisition.
const GLOBAL_AFTER_MS = 8_000;
const GLOBAL_MAX_PERP_M = 75;
const GLOBAL_HEADING_MAX_DEG = 75;
const CLUSTER_WITHIN_M = 100;
const FORWARD_SLACK_M = 50;
const REACQ_STABLE_HITS = 3;
/** Forward jumps larger than this are reported as a skipped loop. */
export const LOOP_SKIP_MIN_JUMP_M = 300;

interface Candidate {
  alongMeters: number;
  perpMeters: number;
  point: LatLng;
  segmentBearing: number;
}

export function createMatcherState(startAlong = 0): MatcherState {
  return { lastAlong: startAlong, offTrackSinceMs: null, reacq: null };
}

/** Project a fix onto every segment in [fromIdx, toIdx), keeping those within maxPerp. */
function projectRange(
  fix: { lat: number; lng: number },
  track: PreparedTrack,
  fromIdx: number,
  toIdx: number,
  maxPerpM: number,
): Candidate[] {
  const { geometry, cum } = track;
  const lat0 = (fix.lat * Math.PI) / 180;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(lat0);
  const px = fix.lng * mPerDegLng;
  const py = fix.lat * mPerDegLat;

  const out: Candidate[] = [];
  for (let i = Math.max(0, fromIdx); i < Math.min(geometry.length - 1, toIdx); i += 1) {
    const [alng, alat] = geometry[i];
    const [blng, blat] = geometry[i + 1];
    const ax = alng * mPerDegLng;
    const ay = alat * mPerDegLat;
    const bx = blng * mPerDegLng;
    const by = blat * mPerDegLat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const perp = Math.hypot(px - cx, py - cy);
    if (perp > maxPerpM) continue;
    out.push({
      alongMeters: cum[i] + Math.sqrt(len2) * t,
      perpMeters: perp,
      point: { lat: alat + (blat - alat) * t, lng: alng + (blng - alng) * t },
      segmentBearing: bearingDegrees(toLatLng(geometry[i]), toLatLng(geometry[i + 1])),
    });
  }
  return out;
}

/** Plain nearest projection over the full geometry — no gates; for the off-track display. */
function nearestAnywhere(fix: { lat: number; lng: number }, track: PreparedTrack): Candidate {
  const all = projectRange(fix, track, 0, track.geometry.length - 1, Number.POSITIVE_INFINITY);
  let best = all[0];
  for (const c of all) if (c.perpMeters < best.perpMeters) best = c;
  return best;
}

function headingPenaltyDeg(headingDeg: number | null, segmentBearing: number): number {
  if (headingDeg === null) return 0;
  return Math.abs(signedAngleDiff(headingDeg, segmentBearing));
}

/** Vertex index range covering [alongFrom, alongTo] (linear scan is fine at fix rate). */
function segmentRangeForWindow(cum: number[], alongFrom: number, alongTo: number): [number, number] {
  let from = 0;
  while (from < cum.length - 1 && cum[from + 1] < alongFrom) from += 1;
  let to = from;
  while (to < cum.length - 1 && cum[to] <= alongTo) to += 1;
  return [from, to];
}

/**
 * Best starting position for a fresh session: the plain nearest projection.
 * (Heading is usually unknown while standing still at the start.)
 */
export function initialAlong(fix: { lat: number; lng: number }, track: PreparedTrack): number {
  return track.geometry.length >= 2 ? nearestAnywhere(fix, track).alongMeters : 0;
}

export function matchFix(
  state: MatcherState,
  fix: MatcherFix,
  track: PreparedTrack,
): { state: MatcherState; result: MatchResult } {
  // ── 1. Local windowed match (fast path) ──────────────────────────────────
  const [fromIdx, toIdx] = segmentRangeForWindow(
    track.cum,
    state.lastAlong - LOCAL_BACK_M,
    state.lastAlong + LOCAL_AHEAD_M,
  );
  const candidates = projectRange(fix, track, fromIdx, toIdx, LOCAL_MAX_PERP_M).filter(
    (c) => c.alongMeters >= state.lastAlong - BACKWARD_REJECT_M,
  );

  let best: Candidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const backward = Math.max(0, state.lastAlong - c.alongMeters);
    const score =
      c.perpMeters +
      backward * BACKWARD_PENALTY_PER_M +
      // Heading agreement keeps out-and-back tracks honest: the return leg's
      // bearing is ~180° off → +72 m-equivalent → never beats the true leg.
      headingPenaltyDeg(fix.headingDeg, c.segmentBearing) * HEADING_PENALTY_PER_DEG;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (best && best.perpMeters <= COMMIT_MAX_PERP_M) {
    return {
      state: { lastAlong: best.alongMeters, offTrackSinceMs: null, reacq: null },
      result: {
        status: "on",
        alongMeters: best.alongMeters,
        snapped: best.point,
        perpMeters: best.perpMeters,
        segmentBearing: best.segmentBearing,
        loopSkipMeters: null,
      },
    };
  }

  // ── 2. Off-track: global re-acquisition (the loop-skip path) ─────────────
  const offSince = state.offTrackSinceMs ?? fix.atMs;
  let nextState: MatcherState = { ...state, offTrackSinceMs: offSince };

  if (fix.atMs - offSince >= GLOBAL_AFTER_MS || candidates.length === 0) {
    const global = projectRange(fix, track, 0, track.geometry.length - 1, GLOBAL_MAX_PERP_M).filter(
      (c) =>
        c.alongMeters >= state.lastAlong - FORWARD_SLACK_M &&
        headingPenaltyDeg(fix.headingDeg, c.segmentBearing) <= GLOBAL_HEADING_MAX_DEG,
    );

    // Cluster by arc-length, keep each cluster's best projection, then prefer
    // the FURTHEST-FORWARD cluster — that's what "skipped the loop" means.
    global.sort((a, b) => a.alongMeters - b.alongMeters);
    const clusters: Candidate[] = [];
    for (const c of global) {
      const last = clusters[clusters.length - 1];
      if (last && c.alongMeters - last.alongMeters < CLUSTER_WITHIN_M) {
        if (c.perpMeters < last.perpMeters) clusters[clusters.length - 1] = c;
      } else {
        clusters.push(c);
      }
    }
    const target = clusters[clusters.length - 1] ?? null;

    if (target) {
      const reacq =
        nextState.reacq && Math.abs(nextState.reacq.candidateAlong - target.alongMeters) < CLUSTER_WITHIN_M
          ? { candidateAlong: target.alongMeters, hits: nextState.reacq.hits + 1 }
          : { candidateAlong: target.alongMeters, hits: 1 };

      if (reacq.hits >= REACQ_STABLE_HITS) {
        const jump = target.alongMeters - state.lastAlong;
        return {
          state: { lastAlong: target.alongMeters, offTrackSinceMs: null, reacq: null },
          result: {
            status: "on",
            alongMeters: target.alongMeters,
            snapped: target.point,
            perpMeters: target.perpMeters,
            segmentBearing: target.segmentBearing,
            loopSkipMeters: jump >= LOOP_SKIP_MIN_JUMP_M ? jump : null,
          },
        };
      }
      nextState = { ...nextState, reacq };
    } else {
      nextState = { ...nextState, reacq: null };
    }
  }

  // ── 3. Still off-track: report the way back ───────────────────────────────
  const nearest = nearestAnywhere(fix, track);
  return {
    state: nextState,
    result: {
      status: "off",
      alongMeters: state.lastAlong,
      distanceBackMeters: nearest.perpMeters,
      nearestPoint: nearest.point,
      offTrackSinceMs: offSince,
    },
  };
}
