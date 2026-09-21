import { Injectable, Logger } from "@nestjs/common";
import { TRACK_ACCESS_TIERS, trackAccessRank, type TrackAccessReport, type TrackAccessTier } from "@events/contracts";
import { distanceBetween, offsetPoint } from "./geo";
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
const MAX_SAMPLES = 600;
/** Points per routing request. GraphHopper slows sharply past ~25 via-points. */
const CHUNK_POINTS = 20;
/**
 * How far the matched route may sit from a sample before the chunk pass gives
 * up on it. Tight, because a route that has wandered this far from the track is
 * usually routing AROUND something rather than along it — the sample is then
 * handed to the probe, which asks about that exact point instead of guessing.
 */
const MATCH_TOLERANCE_M = 70;
/**
 * How far the engine may snap a probed point and still be describing the way
 * the course runs on.
 *
 * Much looser than the chunk tolerance, and deliberately so. Race GPX is drawn
 * by hand off a screen or recorded under tree cover on a phone, and on a real
 * course it sits well off the centreline of the track it follows for kilometres
 * at a time — measured against OSM on the K3 Ultra courses, stretches drawn as
 * open mountainside had a mapped path 150-250 m away, which is the trail the
 * race is plainly run on. Rejecting those is the more dangerous of the two
 * errors: it says carry when a bike could have ridden in.
 *
 * The price is that a way this far off might be a different way, so the probe
 * takes the NEAREST network rather than the most capable one — see
 * {@link TrackAccessService.probe}. Past this the snap is in another valley and
 * the honest answer is that there is nothing there.
 */
const SNAP_TOLERANCE_M = 250;
/**
 * How far along the course a probe's second point sits, in order of preference.
 *
 * More than one, because the mate is the part that fails. GraphHopper rejects
 * the whole request when ANY point of it cannot be snapped, so a probe of a
 * sample sitting twenty metres from a path was being thrown away because its
 * partner thirty metres up the course happened to be off the network — the
 * point we were asking about never got an answer.
 */
const PROBE_MATE_M = [30, -30, 80, -80];

/**
 * Last resort: a ring of points around the sample, each asked separately.
 *
 * GraphHopper's own snap radius is a server setting we do not control, and out
 * here it gives up while a path is still well within walking distance. Asking
 * from a point a hundred metres away moves that radius rather than widening it,
 * and whatever it finds is still measured back to the real sample — so the ring
 * extends the engine's reach without loosening what we are willing to believe.
 */
const RING_RADII_M = [120, 220];
const RING_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
/** Probes run in parallel — each is a two-point route over a few edges. */
const PROBE_CONCURRENCY = 6;
/** Ceiling on probes per course, so a course off the network stays bounded. */
const MAX_PROBES = 600;

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
function tierFor(tags: SampleTags): TrackAccessTier | null {
  const { roadClass, surface, trackType } = tags;
  // `access=private` is deliberately NOT treated as no-access. On these courses
  // a fifth of the mapped ways are private or forestry roads — gated logging
  // tracks — and drawing them as open mountainside told a planner to carry a
  // casualty down a road an ambulance could have driven up. This view answers
  // what the GROUND allows; a gate is a phone call, and the plan is better for
  // knowing the road is there.
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
  // Nothing usable. NOT "none" — there is a way here, we just cannot describe
  // it from tags, and calling that open mountainside would be a lie. The caller
  // falls back to what the engine itself proved by routing over it.
  return null;
}

/**
 * What a way is worth when its tags say nothing, judged by the network that
 * agreed to route over it. Weak evidence, but evidence: the `car` profile does
 * not drive footpaths.
 */
const PROFILE_FLOOR: Record<string, TrackAccessTier> = {
  car: "car",
  rescue_4x4: "offroad-car",
  mtb: "atv",
  foot: "foot",
};

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

    const walk = measure(coordinates);
    const samples = resample(walk, totalMeters, bins);
    const tiers = await this.readCourse(walk, samples);
    const report = toBins(tiers, bins, totalMeters);
    this.cache.set(key, report);
    return report;
  }

  /**
   * Two passes, because they answer different questions.
   *
   * The chunk pass routes THROUGH the course and reads the ways it runs over —
   * cheap, and right wherever the track sits on the network. The probe pass
   * then goes back to every sample the first pass could not place and asks the
   * engine about that one point: where would you put it, and on what. That
   * second question is the one that matters on real race GPX, where the line is
   * a drawing of a trail rather than the trail itself.
   */
  private async readCourse(walk: MeasuredCourse, samples: LngLat[]): Promise<Array<TrackAccessTier | null>> {
    const out = new Array<TrackAccessTier | null>(samples.length).fill(null);
    for (let start = 0; start < samples.length - 1; start += CHUNK_POINTS - 1) {
      await this.matchSpan(samples, start, Math.min(samples.length, start + CHUNK_POINTS), out);
    }

    const unresolved: number[] = [];
    for (let i = 0; i < out.length; i += 1) if (out[i] === null) unresolved.push(i);
    if (unresolved.length === 0) return out;

    const targets = unresolved.slice(0, MAX_PROBES);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: PROBE_CONCURRENCY }, async () => {
        while (cursor < targets.length) {
          const index = targets[cursor];
          cursor += 1;
          out[index] = await this.probe(walk, samples[index], index);
        }
      }),
    );
    if (unresolved.length > targets.length) {
      this.logger.warn(`course hit the probe ceiling — ${unresolved.length - targets.length} samples left unread`);
    }
    // Worth keeping: every wrong-looking course so far has been diagnosable
    // from these three numbers and the spread of tiers under them.
    const rescued = targets.filter((i) => out[i] !== null).length;
    const hist = new Map<string, number>();
    for (const tier of out) hist.set(tier ?? "no way", (hist.get(tier ?? "no way") ?? 0) + 1);
    this.logger.debug(
      `${samples.length} samples: ${samples.length - unresolved.length} matched, ` +
        `${rescued}/${targets.length} rescued · ` +
        [...hist].map(([tier, n]) => `${tier}:${n}`).join(" "),
    );
    return out;
  }

  /**
   * Route through `samples[start, end)` and record what the ways under it are.
   *
   * On failure the span is BISECTED rather than abandoned. GraphHopper fails a
   * whole request when any single point of it cannot be snapped ("Cannot find
   * point 17"), so one sample in a quarry took twenty with it — four kilometres
   * of course drawn as unmapped because of one point. Halving isolates the bad
   * point and keeps everything either side of it.
   */
  private async matchSpan(
    samples: LngLat[],
    start: number,
    end: number,
    out: Array<TrackAccessTier | null>,
    profile: RouteProfile = "foot",
  ): Promise<void> {
    const points = samples.slice(start, end);
    if (points.length < 2) return;

    const path = await this.graphhopper.tryRoute(profile, points, {
      instructions: false,
      elevation: false,
      details: true,
    });
    if (!path) {
      // A pair that will not route is left for the probe pass, which asks about
      // each of its points separately.
      if (points.length <= 2) return;
      const mid = start + Math.floor((end - start) / 2);
      await this.matchSpan(samples, start, mid + 1, out, profile);
      await this.matchSpan(samples, mid, end, out, profile);
      return;
    }

    const geometry = (path.points?.coordinates ?? []).map((c) => [c[0], c[1]] as LngLat);
    if (geometry.length < 2) return;
    const tags = tagsForPath(geometry.length, path.details);
    for (let i = 0; i < points.length; i += 1) {
      const index = start + i;
      if (index >= out.length || out[index] !== null) continue;
      const nearest = nearestVertex(geometry, points[i]);
      if (!nearest || nearest.meters > MATCH_TOLERANCE_M) continue;
      out[index] = tierFor(tags[nearest.index] ?? {});
    }
  }

  /**
   * Ask the engine about one point: is there a way here, and what is it.
   *
   * Routed as a pair with a mate thirty metres along the course, because two
   * points that close share an edge — the route cannot fail for want of a
   * connection between them, which a pair of neighbouring samples two hundred
   * metres apart very much can. What the answer turns on is `snapped_waypoints`:
   * where GraphHopper decided the point belongs.
   *
   * All three networks are asked and the NEAREST answer wins, not the most
   * capable one. That ordering is the whole game at this tolerance: ask the car
   * network first and take what it offers, and a course on a footpath sixty
   * metres away gets labelled with the valley road two hundred metres below it,
   * which is precisely the mistake that would send a van up a goat track.
   * Equal distances go to the more capable network, since that is then a way
   * both of them can use.
   */
  private async probe(walk: MeasuredCourse, sample: LngLat, index: number): Promise<TrackAccessTier | null> {
    const along = index * walk.spacing;
    const mates = PROBE_MATE_M.map((m) => pointAlong(walk, along + m));
    const direct = await this.snapNearest(sample, sample, mates);
    if (direct) return direct.tier;

    // Nothing the engine would snap from the sample itself. Ask from around it.
    let best: { meters: number; tier: TrackAccessTier } | null = null;
    for (const radius of RING_RADII_M) {
      for (const bearing of RING_BEARINGS) {
        const from = offsetPoint(sample, bearing, radius);
        const found = await this.snapNearest(sample, from, [offsetPoint(from, bearing + 90, 30)]);
        if (found && (!best || found.meters < best.meters)) best = found;
      }
      if (best) break; // the inner ring found something; a wider one cannot beat it
    }
    return best?.tier ?? null;
  }

  /**
   * Route a short pair from `from` and report where it snapped, measured back
   * to `sample` — with the NEAREST network winning, not the most capable one.
   *
   * That ordering is the whole game at this tolerance: ask the car network
   * first and take what it offers, and a course on a footpath sixty metres away
   * gets labelled with the valley road two hundred metres below it, which is
   * precisely the mistake that would send a van up a goat track. Equal
   * distances go to the more capable network, since that is then a way both of
   * them can use.
   */
  private async snapNearest(
    sample: LngLat,
    from: LngLat,
    mates: Array<LngLat | null>,
  ): Promise<{ meters: number; tier: TrackAccessTier } | null> {
    let best: { meters: number; tier: TrackAccessTier } | null = null;
    for (const profile of ["car", "mtb", "foot"] as RouteProfile[]) {
      for (const mate of mates) {
        if (!mate || distanceBetween(mate, from) < 1) continue;
        const path = await this.graphhopper.tryRoute(profile, [from, mate], {
          instructions: false,
          elevation: false,
          details: true,
        });
        const snapped = path?.snapped_waypoints?.coordinates?.[0];
        if (!path || !snapped) continue; // this mate was the unsnappable one — try the next
        const meters = distanceBetween([snapped[0], snapped[1]], sample);
        if (meters <= SNAP_TOLERANCE_M) {
          const tags = tagsForPath(Math.max(1, path.points?.coordinates?.length ?? 1), path.details)[0] ?? {};
          const tier = tierFor(tags) ?? PROFILE_FLOOR[profile] ?? "foot";
          if (!best || meters < best.meters - 1) best = { meters, tier };
        }
        break; // this network has answered; the other mates would only repeat it
      }
    }
    return best;
  }
}

/**
 * Collapse per-sample readings onto the planner's evenly spaced bins.
 *
 * A bin is `none` only when NOTHING in it was read. Letting an unread sample
 * win a bin on a tie — which is what this did first — turned a course that was
 * two thirds mapped into a course drawn almost entirely grey, because at four
 * samples per bin a single gap outvoted the road it sat on.
 */
function toBins(tiers: Array<TrackAccessTier | null>, bins: number, totalMeters: number): TrackAccessReport {
  const out = new Array<TrackAccessTier>(bins).fill("none");
  for (let bin = 0; bin < bins; bin += 1) {
    const from = Math.floor((bin * tiers.length) / bins);
    const to = Math.max(from + 1, Math.floor(((bin + 1) * tiers.length) / bins));
    const counts = new Map<TrackAccessTier, number>();
    let read = 0;
    for (let i = from; i < to && i < tiers.length; i += 1) {
      const tier = tiers[i];
      if (tier === null) continue;
      read += 1;
      counts.set(tier, (counts.get(tier) ?? 0) + 1);
    }
    if (read === 0) continue;
    // The tier most of the READ samples are, ties going to the less capable of
    // them: half a kilometre of forest track with a paved crossing in it is a
    // forest track, and saying otherwise is the error that strands a van.
    let best: TrackAccessTier = "none";
    let bestCount = -1;
    for (const tier of TRACK_ACCESS_TIERS) {
      const count = counts.get(tier) ?? 0;
      if (count > 0 && count >= bestCount) {
        best = tier;
        bestCount = count;
      }
    }
    out[bin] = best;
  }
  const unread = tiers.filter((t) => t === null || t === "none").length;
  return {
    tiers: out,
    unmappedMeters: tiers.length > 0 ? Math.round((unread / tiers.length) * totalMeters) : 0,
    totalMeters: Math.round(totalMeters),
  };
}

function courseLength(coordinates: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) total += distanceBetween(coordinates[i - 1], coordinates[i]);
  return total;
}

/**
 * The course with its cumulative distances, so any point along it can be found
 * by metre. The probes need that: a mate thirty metres along the real line, not
 * the next sample two hundred metres away.
 */
interface MeasuredCourse {
  coordinates: LngLat[];
  cumulative: number[];
  totalMeters: number;
  /** Metres between samples, filled in by {@link resample}. */
  spacing: number;
}

function measure(coordinates: LngLat[]): MeasuredCourse {
  const cumulative = [0];
  for (let i = 1; i < coordinates.length; i += 1) {
    cumulative.push(cumulative[i - 1] + distanceBetween(coordinates[i - 1], coordinates[i]));
  }
  return { coordinates, cumulative, totalMeters: cumulative[cumulative.length - 1] ?? 0, spacing: 0 };
}

/** The point `meters` along the course, clamped to its ends. */
function pointAlong(walk: MeasuredCourse, meters: number): LngLat | null {
  const { coordinates, cumulative } = walk;
  if (coordinates.length === 0) return null;
  const target = Math.max(0, Math.min(walk.totalMeters, meters));
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = cumulative[hi] - cumulative[lo];
  const t = span > 0 ? (target - cumulative[lo]) / span : 0;
  return [
    coordinates[lo][0] + (coordinates[hi][0] - coordinates[lo][0]) * t,
    coordinates[lo][1] + (coordinates[hi][1] - coordinates[lo][1]) * t,
  ];
}

/**
 * Evenly spaced points along the course, at most {@link MAX_SAMPLES} of them and
 * never fewer than two per bin.
 *
 * That floor is not a refinement. Sampled by distance alone, a 13 km course
 * produced 69 readings for 96 bins — a third of the bins had no sample in them
 * at ALL and were drawn as unmapped ground, on a course that runs down a road.
 * The bins are the resolution the planner draws at, so they set the resolution
 * we have to read at.
 */
function resample(walk: MeasuredCourse, totalMeters: number, bins: number): LngLat[] {
  const wanted = Math.max(bins * 2 + 1, Math.round(totalMeters / SAMPLE_SPACING_M) + 1);
  const count = Math.max(2, Math.min(MAX_SAMPLES, wanted));
  const spacing = totalMeters / (count - 1);
  walk.spacing = spacing;
  const out: LngLat[] = [];
  for (let i = 0; i < count; i += 1) {
    const point = pointAlong(walk, i * spacing);
    if (point) out.push(point);
  }
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
