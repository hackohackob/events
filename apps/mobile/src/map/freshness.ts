// Freshness coloring shared by map markers and detail panels.
//
//   0–20 min : green, getting *greener* (more saturated) the fresher it is
//   20–40 min: yellow
//   > 40 min : grey
//
// The "fresher = greener" gradient interpolates from a pale green at the 20-min
// edge to a vivid green at 0 min.

// Readable saturated green at age 0 (white initials must stay legible), fading
// to a muted sage near the 20-min edge.
const GREEN_FRESH = { r: 0x16, g: 0xb8, b: 0x5c }; // (22,184,92)
const GREEN_EDGE = { r: 0x4d, g: 0x8a, b: 0x68 }; // (77,138,104)
const YELLOW = "#f5c518";
const GREY = "#7c8a9c";

const TWENTY_MIN = 20 * 60_000;
const FORTY_MIN = 40 * 60_000;

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Returns a hex/rgb color string for a location age in milliseconds. */
export function freshnessColor(ageMs: number | undefined): string {
  if (ageMs === undefined || !Number.isFinite(ageMs)) {
    return GREY;
  }
  if (ageMs <= 0) {
    return `rgb(${GREEN_FRESH.r}, ${GREEN_FRESH.g}, ${GREEN_FRESH.b})`;
  }
  if (ageMs < TWENTY_MIN) {
    const t = ageMs / TWENTY_MIN; // 0 (fresh) → 1 (edge)
    const r = lerp(GREEN_FRESH.r, GREEN_EDGE.r, t);
    const g = lerp(GREEN_FRESH.g, GREEN_EDGE.g, t);
    const b = lerp(GREEN_FRESH.b, GREEN_EDGE.b, t);
    return `rgb(${r}, ${g}, ${b})`;
  }
  if (ageMs < FORTY_MIN) {
    return YELLOW;
  }
  return GREY;
}

export type FreshnessBucket = "fresh" | "warning" | "stale";

export function freshnessBucket(ageMs: number | undefined): FreshnessBucket {
  if (ageMs === undefined || ageMs >= FORTY_MIN) return "stale";
  if (ageMs >= TWENTY_MIN) return "warning";
  return "fresh";
}

/** Human label for a location age, e.g. "3m ago", "just now", "—". */
export function freshnessLabel(ageMs: number | undefined): string {
  if (ageMs === undefined || !Number.isFinite(ageMs)) return "—";
  if (ageMs < 30_000) return "just now";
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return "<1m ago";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}
