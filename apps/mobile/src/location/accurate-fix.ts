import * as ExpoLocation from "expo-location";
import { AppState, Platform } from "react-native";
import { noteEnergyEvent } from "../debug/battery-diagnostics";
import { describeError } from "../debug/debug-log";

/**
 * Get a FRESH, precise fix — the thing Google Maps does when you open it, and
 * the thing a bare `getCurrentPositionAsync({})` does not.
 *
 * Why the bare call is not enough: its default accuracy is `Balanced`, which on
 * Android is PRIORITY_BALANCED_POWER_ACCURACY (Wi-Fi / cell towers, no GPS) and
 * on iOS kCLLocationAccuracyHundredMeters, and on Android it will also hand back
 * a cached fused position. Out in the open, with no Wi-Fi around, that is a
 * cell-tower guess hundreds of metres to kilometres off — until some other app
 * switches the GPS on and the fused provider finally has something better.
 *
 * So instead: a short burst of a 1 s BestForNavigation watch (PRIORITY_HIGH_
 * ACCURACY — the GPS radio), keeping the best fix seen, and stopping the moment
 * one is good enough. The first fix usually arrives within a second or two (a
 * coarse one), later ones tighten as satellites lock; `onFix` lets the caller
 * show that progression instead of a spinner.
 *
 * iOS in the background is the exception: expo-location's watch is
 * foreground-only there (allowsBackgroundLocationUpdates = false), so it falls
 * back to one high-accuracy getCurrentPositionAsync raced against the timeout.
 *
 * One burst at a time: overlapping callers (locate button pressed during an
 * automatic re-measure) share it — a second GPS subscription would buy nothing.
 */

export interface AccurateFixOptions {
  /** Give up after this long and return the best fix seen. */
  timeoutMs: number;
  /** Stop as soon as a fresh fix is at least this good (metres). */
  targetAccuracyM: number;
  /** Called for every fresh fix; `improved` = better than anything before it. */
  onFix?: (location: ExpoLocation.LocationObject, improved: boolean) => void;
}

export interface AccurateFixResult {
  /** Most accurate FRESH fix seen, or null if none arrived. */
  best: ExpoLocation.LocationObject | null;
  /** Fresh fixes received during the burst. */
  fixes: number;
  /** Fixes ignored because the OS replayed a cached position from before the request. */
  cachedSkipped: number;
  durationMs: number;
  reachedTarget: boolean;
  method: "watch" | "single";
  error?: unknown;
}

/** A fix timestamped earlier than this before the request is a cached replay. */
const CACHED_TOLERANCE_MS = 3_000;

let inFlight: { promise: Promise<AccurateFixResult>; listeners: Set<NonNullable<AccurateFixOptions["onFix"]>> } | null = null;

export function isAcquiringAccurateFix(): boolean {
  return inFlight != null;
}

function accuracyOf(location: ExpoLocation.LocationObject | null): number {
  return location?.coords.accuracy ?? Number.POSITIVE_INFINITY;
}

export function acquireAccurateFix(opts: AccurateFixOptions): Promise<AccurateFixResult> {
  if (inFlight) {
    if (opts.onFix) inFlight.listeners.add(opts.onFix);
    const listener = opts.onFix;
    return inFlight.promise.finally(() => {
      if (listener) inFlight?.listeners.delete(listener);
    });
  }
  const listeners = new Set<NonNullable<AccurateFixOptions["onFix"]>>();
  if (opts.onFix) listeners.add(opts.onFix);
  const promise = run(opts, listeners).finally(() => {
    inFlight = null;
  });
  inFlight = { promise, listeners };
  return promise;
}

async function run(
  opts: AccurateFixOptions,
  listeners: Set<NonNullable<AccurateFixOptions["onFix"]>>,
): Promise<AccurateFixResult> {
  noteEnergyEvent("gpsBurst");
  const startedAt = Date.now();
  const useWatch = Platform.OS === "android" || AppState.currentState === "active";

  if (!useWatch) {
    try {
      const location = await Promise.race([
        ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.BestForNavigation }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), opts.timeoutMs)),
      ]);
      const fresh = location && location.timestamp >= startedAt - CACHED_TOLERANCE_MS ? location : null;
      if (fresh) for (const l of listeners) l(fresh, true);
      return {
        best: fresh,
        fixes: fresh ? 1 : 0,
        cachedSkipped: location && !fresh ? 1 : 0,
        durationMs: Date.now() - startedAt,
        reachedTarget: accuracyOf(fresh) <= opts.targetAccuracyM,
        method: "single",
      };
    } catch (err) {
      return { best: null, fixes: 0, cachedSkipped: 0, durationMs: Date.now() - startedAt, reachedTarget: false, method: "single", error: describeError(err) };
    }
  }

  return new Promise<AccurateFixResult>((resolve) => {
    let best: ExpoLocation.LocationObject | null = null;
    let fixes = 0;
    let cachedSkipped = 0;
    let sub: ExpoLocation.LocationSubscription | null = null;
    let done = false;
    let error: unknown;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub?.remove();
      sub = null;
      resolve({
        best,
        fixes,
        cachedSkipped,
        durationMs: Date.now() - startedAt,
        reachedTarget: accuracyOf(best) <= opts.targetAccuracyM,
        method: "watch",
        error,
      });
    };
    const timer = setTimeout(finish, opts.timeoutMs);

    ExpoLocation.watchPositionAsync(
      { accuracy: ExpoLocation.Accuracy.BestForNavigation, timeInterval: 1_000, distanceInterval: 0 },
      (location) => {
        if (done) return;
        noteEnergyEvent("gpsFix");
        // The fused provider happily replays its last position first — the
        // very vague fix we're trying to get away from. Only fixes produced
        // after the request count.
        if (location.timestamp < startedAt - CACHED_TOLERANCE_MS) {
          cachedSkipped += 1;
          return;
        }
        fixes += 1;
        const improved = accuracyOf(location) < accuracyOf(best);
        if (improved) best = location;
        for (const l of listeners) {
          try {
            l(location, improved);
          } catch {
            // a UI callback must not end the burst
          }
        }
        if (accuracyOf(best) <= opts.targetAccuracyM) finish();
      },
    )
      .then((s) => {
        if (done) s.remove();
        else sub = s;
      })
      .catch((err) => {
        error = describeError(err);
        finish();
      });
  });
}
