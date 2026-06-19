import { useEffect, useRef, useState } from "react";

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
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
  timestamp: new Date().toISOString(),
};

/**
 * Continuous high-accuracy geolocation. Grabs a one-shot fix immediately for a
 * fast first position, then watches for updates. Always keeps the latest fix so
 * "you" is visible and an SOS can snapshot instantly.
 */
export function useGeolocation(onStream?: (fix: Fix) => void, streamEveryMs = 180_000) {
  const [fix, setFix] = useState<Fix | null>(import.meta.env.DEV ? DEV_SEED : null);
  const [denied, setDenied] = useState(false);
  const lastStreamRef = useRef(0);
  const streamRef = useRef(onStream);
  streamRef.current = onStream;

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      if (!import.meta.env.DEV) setDenied(true);
      return;
    }
    const onPos = (pos: GeolocationPosition) => {
      setDenied(false);
      const next: Fix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? 9999,
        heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
        timestamp: new Date(pos.timestamp).toISOString(),
      };
      setFix(next);
      const now = Date.now();
      if (streamRef.current && now - lastStreamRef.current >= streamEveryMs) {
        lastStreamRef.current = now;
        streamRef.current(next);
      }
    };
    const onErr = () => {
      if (!import.meta.env.DEV) setDenied(true); // keep the dev seed usable locally
    };

    // Fast first fix, then keep watching.
    navigator.geolocation.getCurrentPosition(onPos, onErr, {
      enableHighAccuracy: true,
      maximumAge: 10_000,
      timeout: 15_000,
    });
    const id = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true,
      maximumAge: 5_000,
      timeout: 20_000,
    });
    return () => navigator.geolocation.clearWatch(id);
  }, [streamEveryMs]);

  return { fix, denied };
}
