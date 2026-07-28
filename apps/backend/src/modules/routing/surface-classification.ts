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
  /** OSM access restriction — a `private` service road is not an exit point. */
  road_access?: DetailInterval[];
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
  roadAccess?: string;
  isHike: boolean;
  isMtbTrail: boolean;
}

function lower(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "missing" || normalized === "other" || normalized === "unknown") return undefined;
  return normalized;
}

/**
 * Spread a list of `[from, to, value]` intervals onto a per-point array.
 *
 * GraphHopper's intervals are **half-open**: the `to` of one run is the `from`
 * of the next, so writing through `to` stamps the boundary vertex with the
 * previous run's tags. That is not cosmetic — a vertex where a forest track
 * meets tarmac would inherit `track_type=grade3` from the track and be rejected
 * as an access point, pushing the reported exit one vertex further along.
 *
 * Each run therefore covers `[from, to)`, and the final run is extended to
 * include the last point so the destination is never left untagged.
 */
function applyInterval(
  target: PointTags[],
  intervals: DetailInterval[] | undefined,
  assign: (tags: PointTags, value: unknown) => void,
): void {
  if (!intervals || target.length === 0) return;
  const lastIndex = target.length - 1;
  for (const [from, to, value] of intervals) {
    const start = Math.max(0, Math.floor(from));
    const exclusiveEnd = Math.floor(to);
    // The run that reaches the end of the path owns the final point too.
    const end = exclusiveEnd >= lastIndex ? lastIndex : Math.min(lastIndex, exclusiveEnd - 1);
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

/** Road classes that are asphalt in practice unless the surface tag disagrees. */
const IMPLICITLY_PAVED_ROAD_CLASSES = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "living_street",
]);

/**
 * Track grades that a road ambulance can still stage on. `grade1` is a solid,
 * usually sealed surface — rejecting every `tracktype` outright (as this module
 * used to) threw away a large share of the genuinely usable rural access roads.
 */
const VEHICLE_TRACK_TYPES = new Set(["grade1"]);

/** Road access values that make a way unusable for a rescue vehicle. */
const BLOCKED_ACCESS = new Set(["private", "no", "customers", "delivery"]);

/**
 * How much we trust that a candidate point really is asphalt.
 * - `confirmed` — an explicit paved `surface` tag.
 * - `likely`    — a road class that is sealed in practice (primary…living_street)
 *                 or `tracktype=grade1`, with no contradicting surface tag.
 * - `unknown`   — drivable class, no surface information at all. Common on rural
 *                 `service`/`unclassified` roads, and frequently gravel.
 *
 * The tier is surfaced to the client rather than collapsed away, so the medic
 * decides how much to trust it instead of the backend silently guessing.
 */
export type PavedConfidence = "confirmed" | "likely" | "unknown";

const CONFIDENCE_RANK: Record<PavedConfidence, number> = { confirmed: 0, likely: 1, unknown: 2 };

/** A point on the probe path that a vehicle could stage on. */
export interface PavedPoint {
  index: number;
  confidence: PavedConfidence;
  roadClass?: string;
  surfaceTag?: string;
}

/** Resolve per-point tags once — every scan below shares this. */
function pointTags(pointCount: number, details: PathDetails | undefined): PointTags[] {
  const tags: PointTags[] = Array.from({ length: pointCount }, () => ({ isHike: false, isMtbTrail: false }));
  if (details) {
    applyInterval(tags, details.road_class, (t, v) => (t.roadClass = lower(v)));
    applyInterval(tags, details.surface, (t, v) => (t.surface = lower(v)));
    applyInterval(tags, details.track_type, (t, v) => (t.trackType = lower(v)));
    applyInterval(tags, details.road_access, (t, v) => (t.roadAccess = lower(v)));
  }
  return tags;
}

/** Confidence that this single point is vehicle-usable asphalt, or null if not. */
function pavedConfidenceAt(tags: PointTags): PavedConfidence | null {
  const { surface, roadClass, trackType, roadAccess } = tags;
  // Must be a road for vehicles — ROAD_CLASSES excludes footway/path/steps.
  if (!roadClass || !ROAD_CLASSES.has(roadClass)) return null;
  // A locked service road is not an extraction point.
  if (roadAccess && BLOCKED_ACCESS.has(roadAccess)) return null;
  if (surface && UNPAVED_SURFACES.has(surface)) return null;
  // A graded track only counts at grade1 (solid/sealed).
  if (trackType && !VEHICLE_TRACK_TYPES.has(trackType)) return null;

  if (surface && PAVED_SURFACES.has(surface)) return "confirmed";
  if (IMPLICITLY_PAVED_ROAD_CLASSES.has(roadClass)) return "likely";
  if (trackType && VEHICLE_TRACK_TYPES.has(trackType)) return "likely";
  return "unknown";
}

/**
 * Every point along a path where a vehicle could stage, best-confidence first
 * within each contiguous run of the same road.
 *
 * Taking only the FIRST paved point (what this module used to expose) threw away
 * most of a probe's value: one path down a valley can cross three different
 * roads, and the junction 100 m further along is often the better staging spot
 * than the point where the path first touches tarmac.
 *
 * Consecutive points on the same road/surface collapse into one entry — the
 * caller wants distinct roads, not every vertex of the same one.
 */
export function pavedPoints(pointCount: number, details: PathDetails | undefined): PavedPoint[] {
  const tags = pointTags(pointCount, details);
  const runs: PavedPoint[] = [];
  let current: PavedPoint | null = null;
  let currentKey: string | null = null;

  for (let index = 0; index < tags.length; index += 1) {
    const confidence = pavedConfidenceAt(tags[index]);
    if (confidence === null) {
      current = null;
      currentKey = null;
      continue;
    }
    const key = `${tags[index].roadClass ?? ""}|${tags[index].surface ?? ""}`;
    if (current && key === currentKey) {
      // Same road — keep the best-tagged vertex of the run.
      if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[current.confidence]) {
        current.confidence = confidence;
        current.index = index;
      }
      continue;
    }
    current = {
      index,
      confidence,
      roadClass: tags[index].roadClass,
      surfaceTag: tags[index].surface,
    };
    currentKey = key;
    runs.push(current);
  }
  return runs;
}

/**
 * Index of the first route point on a vehicle-usable paved road, or null.
 * Thin wrapper over {@link pavedPoints}, kept for callers that only need the
 * single best-effort answer.
 */
export function firstPavedPointIndex(pointCount: number, details: PathDetails | undefined): number | null {
  const points = pavedPoints(pointCount, details);
  if (points.length === 0) return null;
  // Prefer a confidently-paved hit over an earlier unknown-surface one.
  const best = [...points].sort(
    (a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] || a.index - b.index,
  )[0];
  return best.index;
}

/**
 * Human hint for a paved point — the road class GraphHopper reported there.
 *
 * GraphHopper intervals are half-open (`to` of one == `from` of the next), so a
 * point that starts a new run matches BOTH. Prefer the run that starts at the
 * index — otherwise the road the medic is being sent to gets labelled with the
 * previous segment's class (a "tertiary" exit reported as "track").
 */
export function roadClassAtPoint(pointIndex: number, pointCount: number, details: PathDetails | undefined): string | undefined {
  if (!details?.road_class) return undefined;
  let fallback: string | undefined;
  for (const [from, to, value] of details.road_class) {
    if (pointIndex >= from && pointIndex < to) return lower(value);
    if (pointIndex >= from && pointIndex <= to && fallback === undefined) fallback = lower(value);
  }
  return fallback;
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
