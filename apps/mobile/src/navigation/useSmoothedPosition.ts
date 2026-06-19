import { useEffect, useRef, useState } from "react";

export interface LatLngLike {
  lat: number;
  lng: number;
}

/**
 * Tweens a position between successive target fixes so the navigation puck
 * glides instead of teleporting. GPS fixes arrive ~1/s; rendering the raw
 * snapped point makes the puck jump a car-length at a time. This animates from
 * the last rendered point to each new target over `durationMs` using
 * requestAnimationFrame, easing out so it settles smoothly.
 *
 * Returns `null` until the first target is seen.
 */
export function useSmoothedPosition(
  target: LatLngLike | null | undefined,
  durationMs = 1000,
): LatLngLike | null {
  const [pos, setPos] = useState<LatLngLike | null>(target ?? null);
  const fromRef = useRef<LatLngLike | null>(target ?? null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!target) return;

    const from = fromRef.current;
    // First fix, or a teleport-sized jump (e.g. re-snap after going off-route):
    // snap straight there rather than animating across the map.
    if (!from || Math.abs(from.lat - target.lat) > 0.02 || Math.abs(from.lng - target.lng) > 0.02) {
      fromRef.current = target;
      setPos(target);
      return;
    }

    const start = Date.now();
    const startPos = from;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);

    const tick = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - (1 - t) * (1 - t); // easeOutQuad
      const next = {
        lat: startPos.lat + (target.lat - startPos.lat) * eased,
        lng: startPos.lng + (target.lng - startPos.lng) * eased,
      };
      fromRef.current = next;
      setPos(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [target?.lat, target?.lng, durationMs]);

  return pos;
}
