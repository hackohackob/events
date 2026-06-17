import { useEffect, useRef, useState } from "react";

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  timestamp: string;
}

/** Discard any fix wider than this accuracy radius (per spec). */
const MAX_ACCURACY_METERS = 150;

/**
 * Continuous high-accuracy geolocation with a strict 150m accuracy filter.
 * Keeps the last good fix so an SOS can snapshot instantly. Optionally streams
 * a throttled low-frequency update to the server every `streamEveryMs`.
 */
export function useGeolocation(onStream?: (fix: Fix) => void, streamEveryMs = 180_000) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [denied, setDenied] = useState(false);
  const lastStreamRef = useRef(0);
  const streamRef = useRef(onStream);
  streamRef.current = onStream;

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setDenied(true);
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy ?? 9999;
        if (acc > MAX_ACCURACY_METERS) return; // strict bad-fix filter
        const next: Fix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: acc,
          heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
          timestamp: new Date(pos.timestamp).toISOString(),
        };
        setFix(next);
        const now = Date.now();
        if (streamRef.current && now - lastStreamRef.current >= streamEveryMs) {
          lastStreamRef.current = now;
          streamRef.current(next);
        }
      },
      () => setDenied(true),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [streamEveryMs]);

  return { fix, denied };
}
