/**
 * Unit tests for the pure track-navigation core (turn detection + matcher).
 * No test framework needed — run with:  npx tsx src/tracknav/__tests__/tracknav.test.ts
 */
import assert from "node:assert";
import type { LngLat } from "../../navigation/types";
import { prepareTrack } from "../turn-detection";
import { createMatcherState, matchFix, initialAlong, type MatcherState } from "../track-matcher";

// ── Synthetic geometry helpers (local metres → lat/lng around Sofia) ────────
const BASE_LAT = 42.7;
const BASE_LNG = 23.3;
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = 111320 * Math.cos((BASE_LAT * Math.PI) / 180);

/** (x=east metres, y=north metres) → [lng, lat] */
const xy = (x: number, y: number): LngLat => [BASE_LNG + x / M_PER_DEG_LNG, BASE_LAT + y / M_PER_DEG_LAT];
const fixAt = (x: number, y: number) => ({ lat: BASE_LAT + y / M_PER_DEG_LAT, lng: BASE_LNG + x / M_PER_DEG_LNG });

/** Straight segment sampled every `step` metres (endpoint included). */
function line(from: [number, number], to: [number, number], step = 20): Array<[number, number]> {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.round(len / step));
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i += 1) {
    pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  }
  return pts;
}

/** Join polyline legs, dropping duplicated joint points. */
function joinLegs(...legs: Array<Array<[number, number]>>): LngLat[] {
  const out: Array<[number, number]> = [];
  for (const leg of legs) {
    for (const p of leg) {
      const last = out[out.length - 1];
      if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 0.01) continue;
      out.push(p);
    }
  }
  return out.map(([x, y]) => xy(x, y));
}

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

// ── Turn detection ───────────────────────────────────────────────────────────

test("straight track produces only the arrive instruction", () => {
  const track = prepareTrack(joinLegs(line([0, 0], [1000, 0])));
  assert.strictEqual(track.instructions.length, 1);
  assert.strictEqual(track.instructions[0].maneuver, "arrive");
  assert.ok(Math.abs(track.totalMeters - 1000) < 5, `total ${track.totalMeters}`);
});

test("straight track with GPS jitter produces no phantom turns", () => {
  // ±4 m lateral wobble — under the 6 m simplification epsilon.
  const pts: LngLat[] = [];
  for (let x = 0; x <= 1000; x += 15) pts.push(xy(x, Math.sin(x / 40) * 4));
  const track = prepareTrack(pts);
  assert.strictEqual(track.instructions.length, 1, `got ${JSON.stringify(track.instructions.map((i) => i.maneuver))}`);
});

test("L-shaped track detects one left turn at the corner", () => {
  // East 500 m then north 500 m: heading 90° → 0° = −90° = left.
  const track = prepareTrack(joinLegs(line([0, 0], [500, 0]), line([500, 0], [500, 500])));
  const turns = track.instructions.filter((i) => i.maneuver !== "arrive");
  assert.strictEqual(turns.length, 1, JSON.stringify(turns));
  assert.strictEqual(turns[0].maneuver, "turn-left");
  assert.ok(Math.abs(turns[0].alongMeters - 500) < 30, `along ${turns[0].alongMeters}`);
});

test("gentle 35° bend classifies as slight, 180° reversal as u-turn", () => {
  const rad = (35 * Math.PI) / 180;
  const bend = prepareTrack(
    joinLegs(line([0, 0], [400, 0]), line([400, 0], [400 + 400 * Math.cos(rad), -400 * Math.sin(rad)])),
  );
  const bendTurns = bend.instructions.filter((i) => i.maneuver !== "arrive");
  assert.strictEqual(bendTurns.length, 1);
  assert.strictEqual(bendTurns[0].maneuver, "turn-slight-right");

  const reversal = prepareTrack(joinLegs(line([0, 0], [400, 0]), line([400, 0], [0, 20])));
  assert.ok(reversal.instructions.some((i) => i.maneuver === "uturn"), JSON.stringify(reversal.instructions));
});

// ── Matcher: happy path ──────────────────────────────────────────────────────

test("matcher follows a straight track through lateral jitter", () => {
  const track = prepareTrack(joinLegs(line([0, 0], [1000, 0])));
  let state: MatcherState = createMatcherState(0);
  let lastAlong = 0;
  for (let x = 0, t = 0; x <= 1000; x += 15, t += 1500) {
    const { state: s, result } = matchFix(
      state,
      { ...fixAt(x, ((x / 15) % 2 === 0 ? 1 : -1) * 6), headingDeg: 90, atMs: t },
      track,
    );
    state = s;
    assert.strictEqual(result.status, "on", `off-track at x=${x}`);
    assert.ok(result.alongMeters >= lastAlong - 1, `regressed at x=${x}`);
    lastAlong = result.alongMeters;
  }
  assert.ok(lastAlong > 950, `final along ${lastAlong}`);
});

test("initialAlong finds a mid-track start", () => {
  const track = prepareTrack(joinLegs(line([0, 0], [1000, 0])));
  const along = initialAlong(fixAt(400, 10), track);
  assert.ok(Math.abs(along - 400) < 15, `along ${along}`);
});

// ── Matcher: out-and-back must not jump to the return leg ───────────────────

test("out-and-back: outbound leg never matches the return pass", () => {
  const track = prepareTrack(joinLegs(line([0, 0], [1000, 0]), line([1000, 0], [0, 0])));
  assert.ok(Math.abs(track.totalMeters - 2000) < 10);

  let state = createMatcherState(0);
  for (let x = 50, t = 0; x <= 950; x += 25, t += 2000) {
    const { state: s, result } = matchFix(state, { ...fixAt(x, 3), headingDeg: 90, atMs: t }, track);
    state = s;
    assert.strictEqual(result.status, "on");
    // Outbound along ≈ x; the return-pass match would be ≈ 2000 − x.
    assert.ok(Math.abs(result.alongMeters - x) < 30, `x=${x} matched along=${result.alongMeters}`);
  }
});

test("out-and-back: after the turnaround the return leg matches forward", () => {
  const track = prepareTrack(joinLegs(line([0, 0], [1000, 0]), line([1000, 0], [0, 0])));
  let state = createMatcherState(980); // just before the turnaround
  for (let x = 990, t = 0; x >= 400; x -= 25, t += 2000) {
    const { state: s, result } = matchFix(state, { ...fixAt(x, -3), headingDeg: 270, atMs: t }, track);
    state = s;
    assert.strictEqual(result.status, "on");
    assert.ok(Math.abs(result.alongMeters - (2000 - x)) < 40, `x=${x} matched along=${result.alongMeters}`);
  }
});

// ── Matcher: lollipop loop — skip and follow ─────────────────────────────────

/** Stem east 0–500, rectangular loop (500–1500), continuation east 1500–2000. */
function lollipop() {
  return prepareTrack(
    joinLegs(
      line([0, 0], [500, 0]),        // stem            along    0– 500
      line([500, 0], [500, 300]),    // loop north           500– 800
      line([500, 300], [700, 300]),  // loop east            800–1000
      line([700, 300], [700, 0]),    // loop south          1000–1300
      line([700, 0], [500, 0]),      // loop west (return)  1300–1500
      line([500, 0], [1000, 0]),     // continuation        1500–2000
    ),
  );
}

test("lollipop: skipping the loop re-acquires forward and reports the jump", () => {
  const track = lollipop();
  let state = createMatcherState(0);
  let loopSkipMeters: number | null = null;
  let finalAlong = 0;

  // Walk the stem, then keep going straight east (skipping the loop).
  let t = 0;
  for (let x = 20; x <= 980; x += 20, t += 2000) {
    const { state: s, result } = matchFix(state, { ...fixAt(x, 2), headingDeg: 90, atMs: t }, track);
    state = s;
    if (result.status === "on") {
      if (result.loopSkipMeters !== null) {
        assert.strictEqual(loopSkipMeters, null, "loop skip fired twice");
        loopSkipMeters = result.loopSkipMeters;
      }
      finalAlong = result.alongMeters;
    }
  }

  assert.ok(loopSkipMeters !== null, "loop skip never detected");
  assert.ok(loopSkipMeters! > 800, `jump ${loopSkipMeters}`);
  assert.ok(finalAlong > 1900, `final along ${finalAlong}`);
});

test("lollipop: actually walking the loop follows it continuously (no skip)", () => {
  const track = lollipop();
  let state = createMatcherState(0);
  let sawSkip = false;
  let lastAlong = 0;
  let t = 0;

  const walk = (points: Array<{ x: number; y: number; h: number }>) => {
    for (const p of points) {
      t += 2000;
      const { state: s, result } = matchFix(state, { ...fixAt(p.x, p.y), headingDeg: p.h, atMs: t }, track);
      state = s;
      assert.strictEqual(result.status, "on", `off-track at (${p.x},${p.y})`);
      if (result.status === "on") {
        if (result.loopSkipMeters !== null) sawSkip = true;
        assert.ok(result.alongMeters >= lastAlong - 60, `regressed at (${p.x},${p.y}): ${result.alongMeters} < ${lastAlong}`);
        lastAlong = result.alongMeters;
      }
    }
  };

  const leg = (x0: number, y0: number, x1: number, y1: number, h: number, step = 25) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.round(len / step));
    return Array.from({ length: n }, (_, i) => ({
      x: x0 + ((x1 - x0) * (i + 1)) / n,
      y: y0 + ((y1 - y0) * (i + 1)) / n,
      h,
    }));
  };

  walk(leg(0, 0, 500, 0, 90));      // stem
  walk(leg(500, 0, 500, 300, 0));   // loop north
  walk(leg(500, 300, 700, 300, 90)); // loop east
  walk(leg(700, 300, 700, 0, 180)); // loop south
  walk(leg(700, 0, 500, 0, 270));   // loop return (west)
  walk(leg(500, 0, 1000, 0, 90));   // continuation

  assert.strictEqual(sawSkip, false, "false loop-skip while following the loop");
  assert.ok(lastAlong > 1900, `final along ${lastAlong}`);
});

test("off-track reports the distance back to the line", () => {
  const track = prepareTrack(joinLegs(line([0, 0], [1000, 0])));
  let state = createMatcherState(300);
  // 200 m north of the line — far past every gate, no forward candidates.
  const { result } = matchFix(state, { ...fixAt(300, 200), headingDeg: 0, atMs: 1000 }, track);
  assert.strictEqual(result.status, "off");
  if (result.status === "off") {
    assert.ok(Math.abs(result.distanceBackMeters - 200) < 10, `back ${result.distanceBackMeters}`);
    assert.strictEqual(result.alongMeters, 300); // progress holds
  }
});

console.log(`\n${passed} tests passed`);
