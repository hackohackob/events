import type { VehicleType } from "@events/contracts";
import type { RouteProfile } from "./routing.types";

/**
 * Ten vehicles on four GraphHopper profiles.
 *
 * The engine gives us `foot`, `mtb`, `car` and `rescue_4x4`. That is not enough
 * to describe ten vehicles on its own — a motorbike is not a mountain bike and
 * an ambulance is not a car — so each vehicle is described by two extra things
 * on top of a base profile:
 *
 *  1. a **restriction custom model**, sent inline with the request, that blocks
 *     the way classes this vehicle may not use. GraphHopper request-level custom
 *     models can only ever narrow a profile, never widen it, so the base profile
 *     is always chosen as the most permissive network the vehicle can legally
 *     use and the model cuts it back down.
 *
 *  2. a **duration factor**, because vehicles sharing a profile do not share a
 *     speed and a restricting model cannot raise one. A motorbike on a forest
 *     track really is about twice a cyclist's pace; the factor says so.
 *
 * Several vehicles list more than one option: a motorbike, an ATV and a 4×4 all
 * genuinely choose between the road network and the track/trail network
 * depending on where the casualty is, so both are routed and the faster one
 * wins. That is the same "measure both, blend neither" approach the exit-point
 * search uses for foot vs bike.
 *
 * What this deliberately does NOT do is give each vehicle its own native
 * GraphHopper profile. That would model speeds exactly, but adding profiles
 * changes the graph's profile set and forces a full re-import of the OSM
 * extract — an offline operation, not something a deploy can do.
 */
export interface VehicleProfileOption {
  profile: RouteProfile;
  /** Multiplier on the profile's own travel time. `1` = the profile is right. */
  durationFactor: number;
  /** Inline custom model narrowing the base profile to this vehicle. */
  restrict?: Record<string, unknown>;
  /** Shown in logs when this option wins, so an odd ETA can be traced. */
  label: string;
}

/**
 * Motorised vehicles riding on the `mtb` network: keep the tracks and trails,
 * drop everything that is legally or physically pedestrian-only.
 */
const NO_PEDESTRIAN_WAYS = {
  priority: [
    { if: "road_class == FOOTWAY || road_class == PEDESTRIAN || road_class == STEPS", multiply_by: "0" },
    { if: "road_access == PRIVATE || road_access == NO", multiply_by: "0" },
    // hike_rating > 0 is OSM sac_scale beyond "hiking" — scrambling terrain that
    // nothing on wheels gets through.
    { if: "hike_rating > 0", multiply_by: "0" },
  ],
} as const;

/** A quad is wider than a motorbike: technical singletrack is out. */
const ATV_WAYS = {
  priority: [
    ...NO_PEDESTRIAN_WAYS.priority,
    { if: "mtb_rating > 2", multiply_by: "0" },
  ],
  speed: [
    // Quads are quick on tracks but not on tarmac; hold them to a sane top end.
    { if: "true", limit_to: "60" },
  ],
} as const;

/** Enduro-style rescue bikes handle rough trail, but not trials-grade rock. */
const MOTORCYCLE_WAYS = {
  priority: [
    ...NO_PEDESTRIAN_WAYS.priority,
    { if: "mtb_rating > 4", multiply_by: "0" },
  ],
} as const;

/**
 * A road ambulance: long wheelbase, low clearance, a casualty in the back. No
 * tracks at all, soft surfaces blocked outright, loose surfaces discouraged.
 */
const ROAD_AMBULANCE_WAYS = {
  priority: [
    { if: "road_class == TRACK", multiply_by: "0" },
    { if: "surface == DIRT || surface == GROUND || surface == GRASS || surface == SAND || surface == MUD", multiply_by: "0" },
    { if: "surface == GRAVEL || surface == FINE_GRAVEL", multiply_by: "0.35" },
    { if: "road_access == PRIVATE || road_access == NO", multiply_by: "0" },
  ],
} as const;

/** A 4×4 ambulance takes tracks, but its body will not clear the worst of them. */
const OFFROAD_AMBULANCE_WAYS = {
  priority: [
    { if: "track_type == GRADE5", multiply_by: "0" },
    { if: "track_type == GRADE4", multiply_by: "0.35" },
    { if: "surface == MUD || surface == SAND", multiply_by: "0.2" },
  ],
  speed: [
    // Driven cautiously with a patient aboard, and top-heavy when empty.
    { if: "true", limit_to: "70" },
  ],
} as const;

/** An e-bike is heavier than a bike: keep it off carry-only scrambles. */
const EBIKE_WAYS = {
  priority: [{ if: "hike_rating > 1", multiply_by: "0" }],
} as const;

/**
 * Routing options per vehicle, best-guess first. Every option is measured and
 * the fastest result wins, so order only matters for logging.
 */
export const VEHICLE_PROFILES: Record<VehicleType, VehicleProfileOption[]> = {
  foot: [{ profile: "foot", durationFactor: 1, label: "foot" }],

  bike: [{ profile: "mtb", durationFactor: 1, label: "mtb" }],

  // Motor assistance mostly pays off on climbs and flat fire roads.
  "e-bike": [{ profile: "mtb", durationFactor: 0.75, restrict: EBIKE_WAYS, label: "mtb/e-assist" }],

  // Light electric bikes are quiet and quick on trail but limited on open road.
  "e-motorcycle": [
    { profile: "mtb", durationFactor: 0.55, restrict: MOTORCYCLE_WAYS, label: "trail" },
    { profile: "rescue_4x4", durationFactor: 0.95, label: "road/track" },
  ],

  motorcycle: [
    { profile: "mtb", durationFactor: 0.5, restrict: MOTORCYCLE_WAYS, label: "trail" },
    { profile: "rescue_4x4", durationFactor: 0.8, label: "road/track" },
  ],

  atv: [
    { profile: "rescue_4x4", durationFactor: 1, label: "track" },
    // A quad also takes wide paths and bridleways the 4×4 model refuses.
    { profile: "mtb", durationFactor: 0.7, restrict: ATV_WAYS, label: "path" },
  ],

  car: [{ profile: "car", durationFactor: 1, label: "road" }],

  "offroad-car": [
    { profile: "rescue_4x4", durationFactor: 1, label: "track" },
    // Tarmac is still faster when the casualty is near a road.
    { profile: "car", durationFactor: 1, label: "road" },
  ],

  ambulance: [{ profile: "car", durationFactor: 1, restrict: ROAD_AMBULANCE_WAYS, label: "road" }],

  "offroad-ambulance": [
    { profile: "rescue_4x4", durationFactor: 1.25, restrict: OFFROAD_AMBULANCE_WAYS, label: "track" },
    { profile: "car", durationFactor: 1.1, restrict: ROAD_AMBULANCE_WAYS, label: "road" },
  ],
};

/** The profile a vehicle should default to for turn-by-turn navigation. */
export function primaryProfile(vehicle: VehicleType): RouteProfile {
  return VEHICLE_PROFILES[vehicle]?.[0]?.profile ?? "foot";
}

/**
 * The option a vehicle uses on a profile the caller already chose (the medic
 * picked it in the transport sheet). Null when the vehicle cannot use that
 * network at all, in which case the caller routes it unrestricted rather than
 * refusing — an explicit human choice outranks our model of their vehicle.
 */
export function optionForProfile(
  vehicle: VehicleType,
  profile: RouteProfile,
): VehicleProfileOption | null {
  return VEHICLE_PROFILES[vehicle]?.find((o) => o.profile === profile) ?? null;
}

/**
 * Cross-country speed in m/s used when no route can be built at all (a medic
 * deep off the mapped network). It backs the straight-line fallback estimate,
 * which the client always labels as such.
 */
export const VEHICLE_DIRECT_SPEED_MS: Record<VehicleType, number> = {
  foot: 1.1,
  bike: 2.2,
  "e-bike": 2.8,
  "e-motorcycle": 4.0,
  motorcycle: 4.4,
  atv: 4.4,
  car: 5.5,
  "offroad-car": 5.5,
  ambulance: 5.5,
  "offroad-ambulance": 5.0,
};
