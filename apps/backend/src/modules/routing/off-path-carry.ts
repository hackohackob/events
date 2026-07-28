/**
 * The off-path leg between an incident and the routable network.
 *
 * GraphHopper snaps a waypoint onto the nearest edge and starts routing from
 * there, silently teleporting across the gap. For an incident out on a hillside
 * that gap is real ground the responders have to cover, and leaving it out
 * understates both distance and time — the route also *draws* starting somewhere
 * the medic is not.
 *
 * Deliberately NOT modelled as a bushwhack. Across a real event area there is
 * usually a trail, firebreak or animal track that OSM simply does not have, so
 * pricing this leg at a cross-country crawl produced worse estimates than
 * pricing it as ordinary walking. It is charged at a slightly-slowed walking
 * pace, and reported separately so the reader can see it rather than having it
 * buried in one blended number.
 */

/** Walking pace used for the off-path leg, metres per second (≈3.4 km/h). */
const CARRY_SPEED_MPS = 0.95;

/**
 * Below this, the gap is snap/GPS noise rather than real ground. GraphHopper
 * routinely snaps a few metres onto the way it is already standing on.
 */
export const CARRY_NOISE_FLOOR_M = 25;

/**
 * Beyond this, the incident is genuinely off-grid and the number stops being a
 * detail worth glossing over — the client calls it out.
 */
export const CARRY_SIGNIFICANT_M = 120;

export interface OffPathCarry {
  /** Straight-line metres from the incident to where the routed path begins. */
  meters: number;
  /** Time to cover it, ms. Zero below the noise floor. */
  durationMs: number;
  /** Worth showing to the user in its own right. */
  significant: boolean;
}

export function offPathCarry(meters: number): OffPathCarry {
  const real = meters > CARRY_NOISE_FLOOR_M ? Math.round(meters) : 0;
  return {
    meters: real,
    durationMs: real > 0 ? Math.round((real / CARRY_SPEED_MPS) * 1000) : 0,
    significant: real >= CARRY_SIGNIFICANT_M,
  };
}
