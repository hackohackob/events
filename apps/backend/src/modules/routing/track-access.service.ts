import { Injectable, Logger } from "@nestjs/common";
import { TRACK_ACCESS_TIERS, trackAccessRank, type TrackAccessReport, type TrackAccessTier } from "@events/contracts";
import { distanceBetween } from "./geo";
import { GraphHopperClient } from "./graphhopper.client";
import type { LngLat, RouteProfile } from "./routing.types";
import type { PathDetails } from "./surface-classification";

/**
 * What can drive each stretch of a race course.
 *
 * A GPX track is just a line: it carries no idea of what it is drawn on, and
 * two identical-looking kilometres can be a village lane an ambulance parks on
 * and a rutted forest climb that needs a quad. The planner has to know which is
 * which before it posts anybody, and nobody is going to eyeball forty
 * kilometres of it on satellite imagery.
 *
 * So the course is map-matched against the routing graph and read back through
 * OSM's own tags. There is no map-matching endpoint on a stock GraphHopper, but
 * there does not need to be one: routing THROUGH a dense chain of points on the
 * track forces the engine along the same ways the track follows, and the
 * `path_details` that come back describe them. Where the engine has to make a
 * long detour to join two neighbouring samples, there is no way there at all —
 * which is the `none` tier, and just as much of an answer as the rest.
 */

/** Sampling along the course. One sample per this many metres. */
const SAMPLE_SPACING_M = 200;
/** Hard cap on samples, so a 100 km course costs the same as a 40 km one. */
const MAX_SAMPLES = 420;
/** Points per routing request. GraphHopper slows sharply past ~25 via-points. */
const CHUNK_POINTS = 20;
/**
 * How far the matched route may sit from the sample before we call it a miss.
 *
 * Generous on purpose: GPX wanders off the centreline, and a track drawn beside
 * the road it runs along is still that road. Beyond this the engine is routing
 * around something rather than along it.
 */
const MATCH_TOLERANCE_M = 45;

/** Drivable, vehicle-grade road classes. */
const ROAD_CLASSES = new Set([
  "motorway", "trunk", "primary", "secondary", "tertiary",
  "unclassified", "residential", "living_street", "service", "road",
]);

/** Classes that are a walking line, not a way. */
const FOOT_ONLY_CLASSES = new Set(["steps", "pedestrian", "corridor", "platform"]);

/** Sealed surfaces — an ambulance parks here. */
const PAVED_SURFACES = new Set([
  "asphalt", "concrete", "concrete:plates", "concrete:lanes",
  "paved", "paving_stones", "sett", "cobblestone", "metal", "wood",
]);

/** Road classes that are sealed in practice unless the surface tag disagrees. */
const IMPLICITLY_PAVED = new Set([
  "motorway", "trunk", "primary", "secondary", "tertiary", "residential", "living_street",
]);

/** Firm enough for a road car; anything softer needs ground clearance. */
const FIRM_SURFACES = new Set(["compacted", "fine_gravel", "gravel", "pebblestone"]);
/** Soft going: a 4×4 keeps moving, a road car digs in. */
const SOFT_SURFACES = new Set(["dirt", "earth", "soil", "ground", "grass", "grass_paver", "mud", "sand", "rock", "woodchips"]);

/** A way nobody may legally use is no better than no way at all. */
const BLOCKED_ACCESS = new Set(["private", "no"]);

interface SampleTags {
  roadClass?: string;
  surface?: string;
  trackType?: string;
  roadAccess?: string;
}

function lower(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "missing" || normalized === "other" || normalized === "unknown") return undefined;
  return normalized;
}

/**
 * The heaviest vehicle that gets through, from one way's tags.
 *
 * Ordered by what actually stops a vehicle: legal access first, then the
 * pedestrian-only classes nothing drives, then the width of the way, and only
 * then the surface. Tags are thin in the mountains, so an untagged drivable
 * class is read as a car road rather than thrown away — the usual case is a
 * rural `unclassified` lane that simply nobody has surveyed.
 */
function tierFor(tags: SampleTags): TrackAccessTier {
  const { roadClass, surface, trackType, roadAccess } = tags;
  if (roadAccess && BLOCKED_ACCESS.has(roadAccess)) return "none";
  if (roadClass && FOOT_ONLY_CLASSES.has(roadClass)) return "foot";
  if (roadClass === "footway") return "bike";
  if (roadClass === "path") return "e-motorcycle";
  if (roadClass === "bridleway" || roadClass === "cycleway") return "atv";

  if (roadClass === "track" || trackType) {
    // OSM tracktype is the one tag that says how rough a track is, and it says
    // it well: grade1 is a sealed farm road, grade5 is two ruts in a field.
    switch (trackType) {
      case "grade1":
        return surface && SOFT_SURFACES.has(surface) ? "offroad-car" : "car";
      case "grade2":
        return "offroad-car";
      case "grade3":
        return "offroad-car";
      case "grade4":
        return "atv";
      case "grade5":
        return "atv";
      default:
        // Untagged track: the surface decides, and a bare "track" is a forest
        // road until something says otherwise.
        if (surface && PAVED_SURFACES.has(surface)) return "car";
        if (surface && SOFT_SURFACES.has(surface)) return "atv";
        return "offroad-car";
    }
  }

  if (roadClass && ROAD_CLASSES.has(roadClass)) {
    if (surface && PAVED_SURFACES.has(surface)) return "ambulance";
    if (surface && SOFT_SURFACES.has(surface)) return "offroad-car";
    if (surface && FIRM_SURFACES.has(surface)) return "car";
    if (IMPLICITLY_PAVED.has(roadClass)) return "ambulance";
    return "car";
  }

  // No class we recognise. A surface tag on its own still tells us something.
  if (surface && PAVED_SURFACES.has(surface)) return "ambulance";
  if (surface && FIRM_SURFACES.has(surface)) return "car";
  if (surface && SOFT_SURFACES.has(surface)) return "atv";
  return "none";
}

/** Spread GraphHopper's half-open `[from, to, value]` intervals onto points. */
function applyInterval(
  target: SampleTags[],
  intervals: Array<[number, number, unknown]> | undefined,
  assign: (tags: SampleTags, value: unknown) => void,
): void {
  if (!intervals || target.length === 0) return;
  const lastIndex = target.length - 1;
  for (const [from, to, value] of intervals) {
    const start = Math.max(0, Math.floor(from));
    const exclusiveEnd = Math.floor(to);
    const end = exclusiveEnd >= lastIndex ? lastIndex : Math.min(lastIndex, exclusiveEnd - 1);
    for (let i = start; i <= end; i += 1) assign(target[i], value);
  }
}

function tagsForPath(pointCount: number, details: PathDetails | undefined): SampleTags[] {
  const tags: SampleTags[] = Array.from({ length: pointCount }, () => ({}));
  if (details) {
    applyInterval(tags, details.road_class as never, (t, v) => (t.roadClass = lower(v)));
    applyInterval(tags, details.surface as never, (t, v) => (t.surface = lower(v)));
    applyInterval(tags, details.track_type as never, (t, v) => (t.trackType = lower(v)));
    applyInterval(tags, details.road_access as never, (t, v) => (t.roadAccess = lower(v)));
  }
  return tags;
}

@Injectable()
export class TrackAccessService {
  private readonly logger = new Logger(TrackAccessService.name);
  /**
   * A course does not change, and reading one costs twenty routing calls, so
   * the answer is kept for the life of the process. Keyed by the course itself
   * (its shape and its length), not by an id: the planner re-uploads the same
   * GPX every time someone opens it.
   */
  private readonly cache = new Map<string, TrackAccessReport>();

  constructor(private readonly graphhopper: GraphHopperClient) {}

  async report(coordinates: LngLat[], bins: number): Promise<TrackAccessReport> {
    const totalMeters = courseLength(coordinates);
    if (coordinates.length < 2 || totalMeters <= 0) {
      return { tiers: new Array<TrackAccessTier>(bins).fill("none"), unmappedMeters: 0, totalMeters: 0 };
    }
    const key = cacheKey(coordinates, bins);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const samples = resample(coordinates, totalMeters);
    const tiers = await this.tiersForSamples(samples);
    const report = this.toBins(tiers, bins, totalMeters);
    this.cache.set(key, report);
    return report;
  }

  /** One tier per sample, in order. */
  private async tiersForSamples(samples: LngLat[]): Promise<TrackAccessTier[]> {
    const out = new Array<TrackAccessTier>(samples.length).fill("none");
    const chunks: Array<{ start: number; points: LngLat[] }> = [];
    // Chunks overlap by one point so every sample is interior to some route and
    // no join is left to the tolerance check alone.
    for (let start = 0; start < samples.length - 1; start += CHUNK_POINTS - 1) {
      chunks.push({ start, points: samples.slice(start, start + CHUNK_POINTS) });
    }

    // Sequential on purpose: a self-hosted GraphHopper running flexible mode is
    // CPU-bound, and twenty parallel matches for one course would starve the
    // navigation requests that people are actually driving on.
    for (const chunk of chunks) {
      const matched = await this.matchChunk(chunk.points);
      if (!matched) continue;
      const { geometry, tags } = matched;
      for (let i = 0; i < chunk.points.length; i += 1) {
        const index = chunk.start + i;
        if (index >= out.length) break;
        const nearest = nearestVertex(geometry, chunk.points[i]);
        if (!nearest || nearest.meters > MATCH_TOLERANCE_M) continue;
        const tier = tierFor(tags[nearest.index] ?? {});
        // A sample already answered by the previous, overlapping chunk keeps the
        // more capable of the two readings: a miss is evidence of nothing.
        if (trackAccessRank(tier) < trackAccessRank(out[index])) out[index] = tier;
      }
    }
    return out;
  }

  /**
   * Route through one chunk of samples and read the ways back.
   *
   * `foot` first because it is the widest network in the graph — it holds the
   * paths and steps a course spends its day on, which the car profile cannot
   * see at all. The vehicle question is answered from the TAGS, not from which
   * profile matched, so matching on foot costs nothing. The fallbacks catch the
   * stretch of dual carriageway that foot is banned from.
   */
  private async matchChunk(points: LngLat[]): Promise<{ geometry: LngLat[]; tags: SampleTags[] } | null> {
    if (points.length < 2) return null;
    const profiles: RouteProfile[] = ["foot", "mtb", "car"];
    for (const profile of profiles) {
      const path = await this.graphhopper.tryRoute(profile, points, {
        instructions: false,
        elevation: false,
        details: true,
      });
      if (!path) continue;
      const geometry = (path.points?.coordinates ?? []).map((c) => [c[0], c[1]] as LngLat);
      if (geometry.length < 2) continue;
      return { geometry, tags: tagsForPath(geometry.length, path.details) };
    }
    this.logger.debug(`no profile could match a ${points.length}-point chunk`);
    return null;
  }

  /** Collapse per-sample tiers onto the planner's evenly spaced bins. */
  private toBins(tiers: TrackAccessTier[], bins: number, totalMeters: number): TrackAccessReport {
    const out = new Array<TrackAccessTier>(bins).fill("none");
    let unmappedSamples = 0;
    for (let bin = 0; bin < bins; bin += 1) {
      const from = Math.floor((bin * tiers.length) / bins);
      const to = Math.max(from + 1, Math.floor(((bin + 1) * tiers.length) / bins));
      const counts = new Map<TrackAccessTier, number>();
      for (let i = from; i < to && i < tiers.length; i += 1) {
        counts.set(tiers[i], (counts.get(tiers[i]) ?? 0) + 1);
      }
      // The tier most of the bin is, ties going to the LESS capable of them:
      // half a kilometre of forest track with a paved crossing in it is a
      // forest track, and saying otherwise is the error that strands a van.
      let best: TrackAccessTier = "none";
      let bestCount = -1;
      for (const tier of TRACK_ACCESS_TIERS) {
        const count = counts.get(tier) ?? 0;
        // `>=` so a tie is won by the LAST tier tested, i.e. the least capable.
        if (count >= bestCount) {
          best = tier;
          bestCount = count;
        }
      }
      out[bin] = best;
    }
    for (const tier of tiers) if (tier === "none") unmappedSamples += 1;
    return {
      tiers: out,
      unmappedMeters: tiers.length > 0 ? Math.round((unmappedSamples / tiers.length) * totalMeters) : 0,
      totalMeters: Math.round(totalMeters),
    };
  }
}

function courseLength(coordinates: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) total += distanceBetween(coordinates[i - 1], coordinates[i]);
  return total;
}

/** Evenly spaced points along the course, at most {@link MAX_SAMPLES} of them. */
function resample(coordinates: LngLat[], totalMeters: number): LngLat[] {
  const count = Math.max(2, Math.min(MAX_SAMPLES, Math.round(totalMeters / SAMPLE_SPACING_M) + 1));
  const spacing = totalMeters / (count - 1);
  const out: LngLat[] = [coordinates[0]];
  let walked = 0;
  let target = spacing;
  for (let i = 1; i < coordinates.length && out.length < count; i += 1) {
    const from = coordinates[i - 1];
    const to = coordinates[i];
    const leg = distanceBetween(from, to);
    if (leg <= 0) continue;
    while (walked + leg >= target && out.length < count) {
      const t = (target - walked) / leg;
      out.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
      target += spacing;
    }
    walked += leg;
  }
  if (out.length < count) out.push(coordinates[coordinates.length - 1]);
  return out;
}

/** Nearest matched-route vertex to a sample, with its distance. */
function nearestVertex(geometry: LngLat[], point: LngLat): { index: number; meters: number } | null {
  let best: { index: number; meters: number } | null = null;
  for (let i = 0; i < geometry.length; i += 1) {
    const meters = distanceBetween(geometry[i], point);
    if (!best || meters < best.meters) best = { index: i, meters };
    // Vertices are ordered along the route: once we are walking away from the
    // sample and already inside tolerance, no later vertex can beat this one.
    if (best.meters < MATCH_TOLERANCE_M && meters > best.meters * 3) break;
  }
  return best;
}

/** Cheap, stable key for one course shape. */
function cacheKey(coordinates: LngLat[], bins: number): string {
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  const mid = coordinates[Math.floor(coordinates.length / 2)];
  const round = (p: LngLat) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  return `${bins}|${coordinates.length}|${round(first)}|${round(mid)}|${round(last)}`;
}
