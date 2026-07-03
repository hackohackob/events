import { useEffect, useRef, useState } from "react";

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  /** Metres above sea level from the GPS, or null when the device omits it
   *  (common on phones) — callers fall back to the track's GPX elevation. */
  altitude: number | null;
  timestamp: string;
}

/** Accuracy beyond this is flagged as low (shows the warning) but still used —
 *  we never want to leave the runner without a visible position. 200–300 m
 *  fixes are perfectly acceptable on trails, so only warn past 300 m. */
export const LOW_ACCURACY_METERS = 300;

/** Local-dev seed so the map/pins are usable without device GPS (a point on the
 *  demo 21K route). Real GPS overrides it the moment a fix arrives. */
const DEV_SEED: Fix = {
  lat: 42.5736,
  lng: 23.4413,
  accuracy: 14,
  heading: null,
  altitude: null,
  timestamp: new Date().toISOString(),
};

/** Accuracy (m) at or below which a fix is "good" — we then poll lazily. */
const GOOD_ACCURACY_METERS = 50;
/** Poll cadence once we have a good fix (battery-friendly). */
const POLL_GOOD_MS = 45_000;
/** Poll cadence while accuracy is still poor (or we have no fix yet). */
const POLL_POOR_MS = 12_000;

/**
 * Adaptive-interval high-accuracy geolocation. Grabs a one-shot fix immediately
 * for a fast first position, then *polls* (rather than continuously watching) so
 * the browser isn't hammered with location requests while the map is open. Once
 * a good fix lands we slow to ~45 s; while accuracy is poor we poll faster.
 * Always keeps the latest fix so "you" is visible and an SOS can snapshot
 * instantly.
 */
export function useGeolocation(onStream?: (fix: Fix) => void, streamEveryMs = 180_000) {
  const [fix, setFix] = useState<Fix | null>(import.meta.env.DEV ? DEV_SEED : null);
  const [denied, setDenied] = useState(false);
  const lastStreamRef = useRef(0);
  const lastAccuracyRef = useRef(Infinity);
  const streamRef = useRef(onStream);
  streamRef.current = onStream;

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      if (!import.meta.env.DEV) setDenied(true);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const delay = lastAccuracyRef.current <= GOOD_ACCURACY_METERS ? POLL_GOOD_MS : POLL_POOR_MS;
      timer = setTimeout(poll, delay);
    };

    const onPos = (pos: GeolocationPosition) => {
      if (cancelled) return;
      setDenied(false);
      const next: Fix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? 9999,
        heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
        altitude: Number.isFinite(pos.coords.altitude) ? (pos.coords.altitude as number) : null,
        timestamp: new Date(pos.timestamp).toISOString(),
      };
      lastAccuracyRef.current = next.accuracy;
      setFix(next);
      const now = Date.now();
      if (streamRef.current && now - lastStreamRef.current >= streamEveryMs) {
        lastStreamRef.current = now;
        streamRef.current(next);
      }
      schedule();
    };
    const onErr = () => {
      if (!import.meta.env.DEV) setDenied(true); // keep the dev seed usable locally
      schedule();
    };

    const poll = () =>
      navigator.geolocation.getCurrentPosition(onPos, onErr, {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 15_000,
      });

    // The page freezes while locked/backgrounded (no background geolocation on
    // the web), so a runner's dot can only refresh while they're looking at the
    // phone. Make every unlock count: on return to foreground, poll right away
    // (instead of waiting out the suspended timer, up to 45 s) and reset the
    // stream throttle so that fix is pushed to the dashboard immediately.
    const onVisible = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      lastStreamRef.current = 0;
      if (timer) clearTimeout(timer);
      poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    // Fast first fix, then poll on an adaptive cadence.
    poll();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
    };
  }, [streamEveryMs]);

  return { fix, denied };
}
