/**
 * Inline GraphHopper custom model for the `rescue_4x4` profile.
 *
 * Sent on top of the base `car` profile (with `ch.disable=true`) so a stock
 * GraphHopper instance can serve rescue routing without a server-side profile.
 * A self-hosted instance can instead define `rescue_4x4` natively — see
 * `apps/backend/graphhopper/config-example.yml`, which additionally adds the
 * slope-based rules that need elevation encoded values.
 *
 * Intent (per the rescue spec):
 *  - allow normal + unpaved roads and suitable tracks
 *  - prefer tracktype grade1–grade3
 *  - avoid private roads, foot-only paths and very narrow trails
 *  - penalize unknown access
 */
export const RESCUE_4X4_CUSTOM_MODEL = {
  distance_influence: 90,
  priority: [
    // Hard blocks: private/forbidden access and foot-only ways.
    { if: "road_access == PRIVATE", multiply_by: "0.0" },
    { if: "road_access == NO", multiply_by: "0.0" },
    { if: "road_class == FOOTWAY || road_class == PATH || road_class == STEPS || road_class == PEDESTRIAN || road_class == BRIDLEWAY", multiply_by: "0.0" },
    // Destination-only access is allowed but discouraged.
    { if: "road_access == DESTINATION", multiply_by: "0.5" },
    // Prefer good tracks; penalize rough ones (very narrow / unmaintained).
    { if: "track_type == GRADE1 || track_type == GRADE2 || track_type == GRADE3", multiply_by: "1.0" },
    { if: "track_type == GRADE4", multiply_by: "0.5" },
    { if: "track_type == GRADE5", multiply_by: "0.25" },
    // Penalize unknown access on minor ways.
    { if: "road_access == OTHER && road_class == TRACK", multiply_by: "0.7" },
  ],
  speed: [
    { if: "road_class == TRACK", limit_to: "30" },
    { if: "surface == GRAVEL || surface == COMPACTED || surface == FINE_GRAVEL", limit_to: "35" },
    { if: "surface == DIRT || surface == GROUND || surface == GRASS || surface == SAND || surface == MUD", limit_to: "20" },
  ],
} as const;
