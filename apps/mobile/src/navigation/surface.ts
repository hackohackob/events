import type { ManeuverKind, RouteProfile, SurfaceClass } from "./types";

/** Segment colours — Blue road / Yellow off-road / Red walking path. */
export const SURFACE_COLORS: Record<SurfaceClass, string> = {
  road: "#3B82F6",
  offroad: "#F4B740",
  path: "#FB5B5B",
};

export const SURFACE_LABELS: Record<SurfaceClass, string> = {
  road: "Road",
  offroad: "Off-road",
  path: "Walking path",
};

/** Legend rows, in drawing priority order. */
export const SURFACE_LEGEND: SurfaceClass[] = ["road", "offroad", "path"];

export const PROFILE_META: Record<RouteProfile, { label: string; icon: string }> = {
  // Feather icon names; 4x4 has no glyph so we use a truck.
  foot: { label: "Foot", icon: "user" },
  mtb: { label: "MTB", icon: "" },
  car: { label: "Car", icon: "" },
  rescue_4x4: { label: "4x4", icon: "truck" },
};

export const PROFILE_ORDER: RouteProfile[] = ["foot", "mtb", "car", "rescue_4x4"];

/**
 * Unicode arrow + short label for a maneuver — used by the next-turn card. We
 * draw with a glyph rather than an icon font so any sign maps to something.
 */
export function maneuverGlyph(maneuver: ManeuverKind): string {
  switch (maneuver) {
    case "turn-left":
    case "turn-sharp-left":
      return "↰";
    case "turn-slight-left":
    case "keep-left":
      return "↖";
    case "turn-right":
    case "turn-sharp-right":
      return "↱";
    case "turn-slight-right":
    case "keep-right":
      return "↗";
    case "uturn":
      return "⮌";
    case "roundabout":
      return "⟳";
    case "arrive":
      return "◎";
    case "depart":
      return "↑";
    case "via":
      return "◆";
    default:
      return "↑";
  }
}

export function maneuverLabel(maneuver: ManeuverKind): string {
  switch (maneuver) {
    case "turn-left":
      return "Turn left";
    case "turn-sharp-left":
      return "Sharp left";
    case "turn-slight-left":
      return "Slight left";
    case "keep-left":
      return "Keep left";
    case "turn-right":
      return "Turn right";
    case "turn-sharp-right":
      return "Sharp right";
    case "turn-slight-right":
      return "Slight right";
    case "keep-right":
      return "Keep right";
    case "uturn":
      return "Make a U-turn";
    case "roundabout":
      return "Enter roundabout";
    case "arrive":
      return "Arrive";
    case "depart":
      return "Depart";
    case "via":
      return "Pass waypoint";
    default:
      return "Continue";
  }
}
