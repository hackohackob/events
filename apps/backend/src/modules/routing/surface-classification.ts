import type { LngLat, RouteSegment, SurfaceClass } from "./routing.types";

/**
 * Classify route geometry into road / off-road / walking-path runs from
 * GraphHopper `path_details`.
 *
 * GraphHopper returns each detail as `[fromPointIndex, toPointIndex, value]`
 * intervals over the route's point array. We resolve a {@link SurfaceClass} per
 * point from the overlapping details, then merge consecutive equal-class points
 * into one drawable segment.
 */

/** One `[from, to, value]` interval as GraphHopper encodes path_details. */
type DetailInterval = [number, number, unknown];

export interface PathDetails {
  road_class?: DetailInterval[];
  surface?: DetailInterval[];
  track_type?: DetailInterval[];
  road_environment?: DetailInterval[];
  smoothness?: DetailInterval[];
  /** Hiking difficulty — any value means it is a walking path. */
  hike_rating?: DetailInterval[];
  /** MTB difficulty — present on bike-only trails. */
  mtb_rating?: DetailInterval[];
}

/** Paved, vehicle-grade road classes → blue. */
const ROAD_CLASSES = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "road",
]);

/** Foot / hiking classes → red. */
const PATH_CLASSES = new Set(["footway", "path", "steps", "pedestrian", "corridor", "platform", "bridleway"]);

/** Off-road vehicle classes → yellow. */
const OFFROAD_CLASSES = new Set(["track", "cycleway"]);

const PAVED_SURFACES = new Set([
  "asphalt",
  "concrete",
  "concrete:plates",
  "concrete:lanes",
  "paved",
  "paving_stones",
  "sett",
  "cobblestone",
  "metal",
  "wood",
]);

const UNPAVED_SURFACES = new Set([
  "unpaved",
  "compacted",
  "fine_gravel",
  "gravel",
  "pebblestone",
  "dirt",
  "earth",
  "soil",
  "ground",
  "grass",
  "grass_paver",
  "mud",
  "sand",
  "rock",
  "woodchips",
]);

interface PointTags {
  roadClass?: string;
  surface?: string;
  trackType?: string;
  isHike: boolean;
  isMtbTrail: boolean;
}

function lower(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "missing" || normalized === "other" || normalized === "unknown") return undefined;
  return normalized;
}

/** Spread a list of `[from, to, value]` intervals onto a per-point array. */
function applyInterval(
  target: PointTags[],
  intervals: DetailInterval[] | undefined,
  assign: (tags: PointTags, value: unknown) => void,
): void {
  if (!intervals) return;
  for (const [from, to, value] of intervals) {
    const start = Math.max(0, Math.floor(from));
    const end = Math.min(target.length - 1, Math.floor(to));
    for (let index = start; index <= end; index += 1) {
      assign(target[index], value);
    }
  }
}

function classifyPoint(tags: PointTags): SurfaceClass {
  // Explicit hiking / sac_scale or a bike-only trail is always a walking path.
  if (tags.isHike) return "path";
  const roadClass = tags.roadClass;
  if (roadClass && PATH_CLASSES.has(roadClass)) return "path";
  if (tags.isMtbTrail && (!roadClass || !ROAD_CLASSES.has(roadClass))) return "path";

  const surface = tags.surface;
  if (surface && UNPAVED_SURFACES.has(surface)) return "offroad";
  if (roadClass && OFFROAD_CLASSES.has(roadClass)) return "offroad";
  if (tags.trackType) return "offroad";

  if (roadClass && ROAD_CLASSES.has(roadClass)) return "road";
  if (surface && PAVED_SURFACES.has(surface)) return "road";

  // Unknown — lean on whatever signal we have, else assume a basic road.
  return "road";
}

/** Build per-point surface classes from raw path_details. */
export function classifyPoints(pointCount: number, details: PathDetails | undefined): SurfaceClass[] {
  const tags: PointTags[] = Array.from({ length: pointCount }, () => ({ isHike: false, isMtbTrail: false }));
  if (details) {
    applyInterval(tags, details.road_class, (t, v) => (t.roadClass = lower(v)));
    applyInterval(tags, details.surface, (t, v) => (t.surface = lower(v)));
    applyInterval(tags, details.track_type, (t, v) => (t.trackType = lower(v)));
    applyInterval(tags, details.hike_rating, (t, v) => {
      if (typeof v === "number" ? v > 0 : Boolean(lower(v))) t.isHike = true;
    });
    applyInterval(tags, details.mtb_rating, (t, v) => {
      if (typeof v === "number" ? v > 0 : Boolean(lower(v))) t.isMtbTrail = true;
    });
  }
  return tags.map(classifyPoint);
}

/**
 * Merge a classified geometry into drawable {@link RouteSegment}s. Each segment
 * shares one surface class and overlaps its neighbour by one point so the drawn
 * lines join seamlessly.
 */
export function buildSegments(
  geometry: LngLat[],
  pointClasses: SurfaceClass[],
  details?: PathDetails,
): RouteSegment[] {
  if (geometry.length < 2) {
    return geometry.length === 1
      ? [{ surface: pointClasses[0] ?? "road", coordinates: [geometry[0]] }]
      : [];
  }

  // Classify each edge by its starting point so an N-point line yields N-1 edges.
  const tags: PointTags[] = Array.from({ length: geometry.length }, () => ({ isHike: false, isMtbTrail: false }));
  if (details) {
    applyInterval(tags, details.road_class, (t, v) => (t.roadClass = lower(v)));
    applyInterval(tags, details.surface, (t, v) => (t.surface = lower(v)));
    applyInterval(tags, details.track_type, (t, v) => (t.trackType = lower(v)));
  }

  const segments: RouteSegment[] = [];
  let current: RouteSegment | null = null;
  let currentClass: SurfaceClass | null = null;

  for (let edge = 0; edge < geometry.length - 1; edge += 1) {
    const edgeClass = pointClasses[edge] ?? pointClasses[edge + 1] ?? "road";
    if (!current || edgeClass !== currentClass) {
      // The previous run already ends at geometry[edge] (pushed last iteration),
      // so the new run starts at the same point — adjacent colours touch.
      if (current) segments.push(current);
      current = {
        surface: edgeClass,
        coordinates: [geometry[edge]],
        roadClass: tags[edge].roadClass,
        surfaceTag: tags[edge].surface,
      };
      currentClass = edgeClass;
    }
    current.coordinates.push(geometry[edge + 1]);
  }
  if (current) segments.push(current);
  return segments;
}
