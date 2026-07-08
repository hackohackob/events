/**
 * Shared "the user's fingers are on the map" signal. The navigation cameras
 * ease programmatically on every GPS tick — while a pinch/drag is in progress
 * they must stand down or they fight the gesture (and the map keeps snapping
 * back mid-pinch). Module-level on purpose: it changes at gesture frequency and
 * must never trigger React re-renders.
 */
let lastMapGestureAt = 0;

export function noteMapGesture(): void {
  lastMapGestureAt = Date.now();
}

export function isMapGestureActive(windowMs = 600): boolean {
  return Date.now() - lastMapGestureAt < windowMs;
}
