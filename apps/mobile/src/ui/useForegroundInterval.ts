import { useEffect, useRef } from "react";
import { AppState } from "react-native";

/**
 * `setInterval` that only ticks while the app is actually on screen.
 *
 * This exists because the medic app is not a normal app: the location
 * foreground service keeps the JS runtime alive with the screen locked, so a
 * plain `setInterval` keeps firing all day. A 3-second timer refreshing a badge
 * nobody can see is 1200 wake-ups an hour of pure drain — and every one of them
 * is a React render plus, in some cases, a native bridge round trip.
 *
 * Guarding each timer by hand worked until someone added a new one and forgot;
 * that is exactly how the offline-queue and tracking-health timers ended up
 * running around the clock while the two next to them were already guarded.
 *
 * The callback is held in a ref, so it can close over fresh state without
 * needing `useCallback` at every call site and without restarting the timer on
 * every render.
 *
 * @param intervalMs  Tick cadence. Pass `null` to disable the timer entirely.
 * @param opts.leading  Also run once immediately when the app becomes active
 *   (default true) — a timer that only feeds the UI is usually stale by the
 *   time you come back to it.
 */
export function useForegroundInterval(
  callback: () => void,
  intervalMs: number | null,
  opts: { leading?: boolean } = {},
): void {
  const leading = opts.leading ?? true;
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (intervalMs == null) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer != null) return;
      if (leading) savedCallback.current();
      timer = setInterval(() => savedCallback.current(), intervalMs);
    };

    const stop = () => {
      if (timer == null) return;
      clearInterval(timer);
      timer = null;
    };

    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") start();
      else stop();
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [intervalMs, leading]);
}
