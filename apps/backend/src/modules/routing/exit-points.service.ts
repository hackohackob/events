import { BadGatewayException, Injectable, Logger } from "@nestjs/common";
import { GraphHopperClient, type GraphHopperPath } from "./graphhopper.client";
import { distanceBetween, offsetPoint } from "./geo";
import { offPathCarry } from "./off-path-carry";
import { pavedPoints, type PavedConfidence } from "./surface-classification";
import type {
  AsphaltAccessLeg,
  AsphaltAccessPath,
  AsphaltAccessPoint,
  ClosestAsphaltResponse,
  LngLat,
} from "./routing.types";

/**
 * Radii the search expands through, metres. It stops at the first ring that has
 * produced enough distinct roads, so a roadside incident costs one ring of
 * probes and only a genuinely remote one pays for the outer sweeps.
 */
const SEARCH_RINGS = [800, 2000, 4500, 9000];

/**
 * Rings used to "unstick" an incident GraphHopper cannot snap at all.
 *
 * High ground is the case that matters: a coordinate on the Musala ridge has no
 * routable edge within the engine's snap radius, so every probe failed and the
 * whole request used to 502 — precisely the situation where knowing the nearest
 * road matters most. When that happens we find the closest point that *can* be
 * routed, run the search from there, and charge the gap as off-path carry.
 */
const ANCHOR_RINGS = [500, 1200, 2200, 3500];
const ANCHOR_BEARINGS = 8;

/**
 * Probe directions per ring. Odd rings are offset half a step so the union of two
 * rings covers twice as many distinct bearings.
 *
 * 12 was too coarse: confirmed asphalt 1330 m south-east of incident 28 was
 * invisible to the search while a 16-bearing sweep found it, because no probe
 * happened to run down that valley. Dedupe and the domination filter absorb the
 * extra raw candidates, so the wider sweep costs probes rather than noise.
 */
const BEARINGS_PER_RING = 16;

/** Stop expanding once this many distinct roads are on the table. */
const ENOUGH_CANDIDATES = 6;

/** Two candidates closer than this are the same piece of road. */
const DEDUPE_M = 220;

/** How many of the nearest candidates get the full routing treatment. */
const MEASURE_LIMIT = 10;

/** How many exit points the client is shown. */
const MAX_POINTS = 5;

/**
 * Compass sectors used to spread the offered points around the incident.
 *
 * Without this, one road corridor takes every slot: incident 28 in the Test
 * event returned four points inside a 12° window to the north-east while
 * confirmed asphalt sat 964 m to the south, 1286 m north-west and 1330 m
 * south-east — all found by the probes, all discarded. A single direction is
 * also the worst possible answer operationally: if that way is blocked, the
 * medic has no alternative to fall back on.
 */
const SECTOR_COUNT = 8;

/**
 * If one point's access path runs within this distance of a nearer point, you
 * walk past the nearer one to get to it, so it adds nothing — the reason
 * "point 4" used to be offered when its route went straight through point 2.
 */
const DOMINATION_M = 150;

/** Road classes ranked by how much a rescue vehicle wants them. Lower is better. */
const ROAD_CLASS_TIER: Record<string, number> = {
  motorway: 0, trunk: 0, primary: 0, secondary: 0, tertiary: 0,
  unclassified: 1, residential: 1, living_street: 1, road: 1,
  service: 2, track: 2,
};
const roadTier = (roadClass?: string): number => ROAD_CLASS_TIER[roadClass ?? ""] ?? 1;

/**
 * A candidate only counts towards "enough, stop expanding" if it is actually
 * inside the ring being probed. A probe routed to a target 800 m out can follow
 * roads for kilometres, so the raw pool fills with far-away roads long before
 * the neighbourhood has really been covered — and the search would stop while
 * still blind to anything nearby.
 */
const IN_RING_TOLERANCE = 1.25;

/**
 * Reject a routed leg whose length is wildly out of proportion to the
 * straight-line distance. Measured against the real Bulgaria graph, an incident
 * off the footpath network makes GraphHopper snap over a kilometre away and then
 * loop around the mountain: a road 1.5 km from the casualty came back as a
 * 24 km, six-and-a-half-hour "walk". That is not a route anybody would take, and
 * presenting it as the recommended extraction is worse than admitting there is
 * no walkable route at all — such points fall back to straight-line.
 */
const DETOUR_LIMIT = 4;
/** Short hops legitimately zig-zag, so only apply the ratio beyond this. */
const DETOUR_FLOOR_M = 600;

/**
 * Selection bias applied to the straight-line distance when picking which
 * candidates to measure. A surface-unverified service road has to be
 * meaningfully closer than a confirmed asphalt road to win the slot — without
 * excluding it outright, since in rural OSM "no surface tag" is the norm rather
 * than the exception.
 */
const CONFIDENCE_BIAS: Record<PavedConfidence, number> = { confirmed: 1, likely: 1.06, unknown: 1.35 };

/** A road the expanding search found, before any routing was spent on it. */
interface Candidate {
  point: LngLat;
  straightMeters: number;
  /** Compass sector index (0..SECTOR_COUNT-1) as seen from the incident. */
  sector: number;
  confidence: PavedConfidence;
  roadClass?: string;
  surfaceTag?: string;
}

/** Which compass sector `point` falls in, seen from `origin`. */
function sectorOf(origin: LngLat, point: LngLat): number {
  const dLng = ((point[0] - origin[0]) * Math.PI) / 180;
  const lat1 = (origin[1] * Math.PI) / 180;
  const lat2 = (point[1] * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const width = 360 / SECTOR_COUNT;
  return Math.floor(((bearing + width / 2) % 360) / width);
}

/**
 * Take up to `limit` items from an already-ranked list, giving every sector a
 * turn before any sector gets a second pick. The best item is always first, so
 * spreading never costs us the top answer — it only decides who fills the rest.
 */
function spreadBySector<T>(ranked: T[], limit: number, sector: (item: T) => number): T[] {
  const picked: T[] = [];
  const deferred: T[] = [];
  const used = new Set<number>();

  for (const item of ranked) {
    if (picked.length >= limit) break;
    if (used.has(sector(item))) {
      deferred.push(item);
      continue;
    }
    used.add(sector(item));
    picked.push(item);
  }
  for (const item of deferred) {
    if (picked.length >= limit) break;
    picked.push(item);
  }
  return picked;
}

/** One profile's measured leg, with the geometry the client can draw. */
interface MeasuredLeg {
  leg: AsphaltAccessLeg;
  path: AsphaltAccessPath;
  offPathMeters: number;
}

/** A candidate after foot/bike/car routing. */
interface Measured extends Candidate {
  foot: MeasuredLeg | null;
  bike: MeasuredLeg | null;
  fromMe?: { distanceMeters: number; durationMs: number };
}

/** Whichever profile produced a drawable path — foot preferred, bike as backup. */
function drawableLeg(m: Measured): MeasuredLeg | null {
  return m.foot ?? m.bike;
}

/** True when at least one profile produced a usable route to this point. */
function routable(m: Measured): boolean {
  return m.foot !== null || m.bike !== null;
}

/** Minutes as the client rounds them, so ranking agrees with what is displayed. */
function displayMinutes(ms: number | undefined): number {
  return ms === undefined ? Infinity : Math.max(1, Math.round(ms / 60000));
}

/** Quickest of the measured profiles, ms. */
function fastestLeg(m: Measured): number | undefined {
  const times = [m.foot?.leg.durationMs, m.bike?.leg.durationMs].filter(
    (t): t is number => typeof t === "number",
  );
  return times.length > 0 ? Math.min(...times) : undefined;
}

/**
 * Finds the nearest paved-road access ("extraction") points around an incident.
 *
 * The search is an expanding circle: probes are fired outward on a ring of
 * bearings, **every** vehicle-usable paved point along each returned path is
 * collected, and the ring grows only while the pool is still thin. Candidates
 * are then ordered by how close they actually are — the points the circle hits
 * first — and only that shortlist is routed for real times.
 *
 * Two deliberate departures from the obvious approach:
 *
 * - Foot and bike times are reported **separately**, never averaged. The two
 *   profiles route over different networks, so a blend described neither and
 *   concealed which one produced the number.
 * - The off-path gap that GraphHopper hides when it snaps the incident onto the
 *   network is measured and charged (see `off-path-carry.ts`), so the distance,
 *   the time and the drawn line all start where the casualty actually is.
 */
@Injectable()
export class ExitPointsService {
  private readonly logger = new Logger(ExitPointsService.name);

  constructor(private readonly graphhopper: GraphHopperClient) {}

  async closestAsphalt(origin: LngLat, from?: LngLat): Promise<ClosestAsphaltResponse> {
    // Probes start from `anchor`, but every distance and every carry is measured
    // from the true incident position. They are the same point unless the
    // incident is off the routable graph entirely (see ANCHOR_RINGS).
    let anchor = origin;
    let search = await this.expandingSearch(anchor, origin);

    if (search.candidates.length === 0) {
      const unstuck = await this.resolveAnchor(origin);
      if (unstuck) {
        this.logger.log(
          `exit points: incident is off the routable graph — anchoring ${Math.round(
            distanceBetween(origin, unstuck),
          )} m away`,
        );
        anchor = unstuck;
        search = await this.expandingSearch(anchor, origin);
      }
    }

    const { candidates, radiusMeters } = search;
    if (candidates.length === 0) {
      throw new BadGatewayException("No paved road reachable around this point.");
    }

    const shortlist = this.shortlist(candidates);
    const measured = await Promise.all(
      shortlist.map((candidate) => this.measure(anchor, origin, candidate, from)),
    );
    const points = this.rank(measured, Boolean(from));

    if (points.length === 0) {
      throw new BadGatewayException("No paved road access could be measured around this point.");
    }
    return {
      origin: { lat: origin[1], lng: origin[0] },
      points,
      searchRadiusMeters: radiusMeters,
    };
  }

  // ── 1. The expanding circle ────────────────────────────────────────────────

  /**
   * Grow through {@link SEARCH_RINGS} until the pool holds enough distinct
   * roads. Each ring probes on both `foot` and `car`: an incident out on a
   * hillside cannot be snapped by the car profile at all, while a roadside one
   * is best served by it — running both removes the old either/or gamble.
   */
  private async expandingSearch(
    anchor: LngLat,
    origin: LngLat,
  ): Promise<{ candidates: Candidate[]; radiusMeters: number }> {
    const pool: Candidate[] = [];
    let radiusMeters = SEARCH_RINGS[0];

    for (const [ringIndex, radius] of SEARCH_RINGS.entries()) {
      radiusMeters = radius;
      const offset = (ringIndex % 2) * (180 / BEARINGS_PER_RING);
      const bearings = Array.from({ length: BEARINGS_PER_RING }, (_, i) => offset + (i * 360) / BEARINGS_PER_RING);

      const found = await Promise.all(
        bearings.flatMap((bearing) => {
          const target = offsetPoint(anchor, bearing, radius);
          return (["foot", "car"] as const).map(async (profile) => {
            const path = await this.graphhopper.tryRoute(profile, [anchor, target], {
              instructions: false,
              elevation: false,
              details: true,
              snapPrevention: ["ferry"],
            });
            return path ? this.candidatesFromPath(origin, path) : [];
          });
        }),
      );

      pool.push(...found.flat());
      const distinct = this.dedupe(pool);
      const inRing = distinct.filter((c) => c.straightMeters <= radius * IN_RING_TOLERANCE);
      if (inRing.length >= ENOUGH_CANDIDATES || ringIndex === SEARCH_RINGS.length - 1) {
        return { candidates: distinct, radiusMeters };
      }
      this.logger.debug(
        `exit points: ${inRing.length} road(s) within ${radius} m (${distinct.length} total) — expanding`,
      );
    }
    return { candidates: this.dedupe(pool), radiusMeters };
  }

  /**
   * Nearest point to `origin` that GraphHopper can actually route from, or null
   * if even that fails. Only called when the incident itself yielded nothing.
   */
  private async resolveAnchor(origin: LngLat): Promise<LngLat | null> {
    for (const radius of ANCHOR_RINGS) {
      const bearings = Array.from({ length: ANCHOR_BEARINGS }, (_, i) => (i * 360) / ANCHOR_BEARINGS);
      const probes = await Promise.all(
        bearings.map(async (bearing) => {
          const point = offsetPoint(origin, bearing, radius);
          // A short hop is enough to prove the point snaps to the network.
          const path = await this.graphhopper.tryRoute("foot", [point, offsetPoint(point, bearing, 300)], {
            instructions: false,
            elevation: false,
            details: false,
          });
          return path ? point : null;
        }),
      );
      const reachable = probes.filter((p): p is LngLat => p !== null);
      if (reachable.length > 0) {
        return reachable.reduce((best, p) =>
          distanceBetween(origin, p) < distanceBetween(origin, best) ? p : best,
        );
      }
    }
    return null;
  }

  /** Every distinct paved road the probe path touched, not just the first. */
  private candidatesFromPath(origin: LngLat, path: GraphHopperPath): Candidate[] {
    const geometry = path.points?.coordinates ?? [];
    if (geometry.length === 0) return [];
    return pavedPoints(geometry.length, path.details).flatMap((paved) => {
      const raw = geometry[paved.index];
      if (!raw) return [];
      const point: LngLat = [raw[0], raw[1]];
      return [
        {
          point,
          straightMeters: Math.round(distanceBetween(origin, point)),
          sector: sectorOf(origin, point),
          confidence: paved.confidence,
          roadClass: paved.roadClass,
          surfaceTag: paved.surfaceTag,
        },
      ];
    });
  }

  /**
   * Collapse candidates that landed on the same piece of road, keeping the
   * best-tagged (then nearest) representative of each cluster.
   */
  private dedupe(pool: Candidate[]): Candidate[] {
    const ordered = [...pool].sort(
      (a, b) =>
        CONFIDENCE_BIAS[a.confidence] - CONFIDENCE_BIAS[b.confidence] || a.straightMeters - b.straightMeters,
    );
    const unique: Candidate[] = [];
    for (const candidate of ordered) {
      const clash = unique.some((kept) => distanceBetween(kept.point, candidate.point) < DEDUPE_M);
      if (!clash) unique.push(candidate);
    }
    return unique;
  }

  /**
   * The points the circle hits first — biased slightly towards trusted surfaces,
   * and spread around the compass so the routing budget is not spent entirely on
   * one corridor of roads that happens to be marginally nearest.
   */
  private shortlist(candidates: Candidate[]): Candidate[] {
    const scored = [...candidates].sort(
      (a, b) =>
        a.straightMeters * CONFIDENCE_BIAS[a.confidence] - b.straightMeters * CONFIDENCE_BIAS[b.confidence],
    );
    return spreadBySector(scored, MEASURE_LIMIT, (c) => c.sector);
  }

  // ── 2. Measurement ─────────────────────────────────────────────────────────

  private async measure(
    anchor: LngLat,
    origin: LngLat,
    candidate: Candidate,
    from?: LngLat,
  ): Promise<Measured> {
    const [footPath, bikePath, carPath] = await Promise.all([
      // Elevation on: the client draws a slope-shaded profile of this leg.
      this.graphhopper.tryRoute("foot", [anchor, candidate.point], {
        instructions: false,
        elevation: true,
        details: false,
        snapPrevention: ["ferry"],
      }),
      // Elevation on both: when the foot network can't sensibly reach the road
      // (common in the mountains) the bike leg becomes the drawn path, and it
      // still needs the series behind the slope shading.
      this.graphhopper.tryRoute("mtb", [anchor, candidate.point], {
        instructions: false,
        elevation: true,
        details: false,
        snapPrevention: ["ferry"],
      }),
      from
        ? this.graphhopper.tryRoute("car", [from, candidate.point], {
            instructions: false,
            elevation: false,
            details: false,
          })
        : Promise.resolve(null),
    ]);

    const foot = footPath ? this.measuredLeg(origin, footPath) : null;
    const bike = bikePath ? this.measuredLeg(origin, bikePath) : null;

    return {
      ...candidate,
      foot: foot && this.isPlausible(foot.leg, candidate.straightMeters) ? foot : null,
      bike: bike && this.isPlausible(bike.leg, candidate.straightMeters) ? bike : null,
      fromMe: carPath
        ? { distanceMeters: Math.round(carPath.distance), durationMs: Math.round(carPath.time) }
        : undefined,
    };
  }

  /**
   * Does this leg describe a route a person would actually walk/ride, or did the
   * router escape through a disconnected part of the network? See DETOUR_LIMIT.
   */
  private isPlausible(leg: AsphaltAccessLeg, straightMeters: number): boolean {
    const ceiling = Math.max(DETOUR_FLOOR_M, straightMeters * DETOUR_LIMIT);
    if (leg.distanceMeters <= ceiling) return true;
    this.logger.debug(
      `exit points: dropped implausible leg — ${leg.distanceMeters} m for ${straightMeters} m straight-line`,
    );
    return false;
  }

  /**
   * Charge the leg for the gap GraphHopper teleported across at the start.
   * `snapped_waypoints[0]` is where the engine actually began; falling back to
   * the first geometry vertex covers builds that omit it.
   */
  private measuredLeg(origin: LngLat, path: GraphHopperPath): MeasuredLeg {
    const snappedRaw = path.snapped_waypoints?.coordinates?.[0] ?? path.points?.coordinates?.[0];
    const snapped: LngLat | null = snappedRaw ? [snappedRaw[0], snappedRaw[1]] : null;
    const carry = offPathCarry(snapped ? distanceBetween(origin, snapped) : 0);
    return {
      leg: {
        distanceMeters: Math.round(path.distance + carry.meters),
        durationMs: Math.round(path.time + carry.durationMs),
      },
      offPathMeters: carry.meters,
      path: this.toAccessPath(origin, path, carry.meters > 0),
    };
  }

  /**
   * GraphHopper path → drawable access path. With `elevation: true` the returned
   * coordinates are `[lng, lat, ele]`, so the elevation series comes for free.
   * Long paths are thinned — the map line and the slope shading do not need
   * every vertex.
   *
   * When there is a real off-path carry the incident itself is prepended as
   * vertex 0, so the drawn line starts at the casualty rather than at whatever
   * edge the router snapped to.
   */
  private toAccessPath(origin: LngLat, path: GraphHopperPath, prependOrigin: boolean): AsphaltAccessPath {
    const MAX_VERTICES = 160;
    const raw = path.points?.coordinates ?? [];
    const step = raw.length > MAX_VERTICES ? Math.ceil(raw.length / MAX_VERTICES) : 1;
    const geometry: LngLat[] = [];
    const elevations: number[] = [];

    for (let i = 0; i < raw.length; i += step) {
      geometry.push([raw[i][0], raw[i][1]]);
      if (raw[i].length > 2) elevations.push(Math.round(raw[i][2] as number));
    }
    // Always keep the true endpoint — thinning must not shorten the line.
    const last = raw[raw.length - 1];
    const tail = geometry[geometry.length - 1];
    if (last && (!tail || tail[0] !== last[0] || tail[1] !== last[1])) {
      geometry.push([last[0], last[1]]);
      if (last.length > 2) elevations.push(Math.round(last[2] as number));
    }

    let routeStartIndex = 0;
    if (prependOrigin && geometry.length > 0) {
      geometry.unshift([origin[0], origin[1]]);
      // The incident's own altitude is unknown here; reuse the first sampled one
      // so the series stays aligned and the carry reads as flat rather than as a
      // spurious cliff.
      if (elevations.length > 0) elevations.unshift(elevations[0]);
      routeStartIndex = 1;
    }

    return {
      geometry,
      elevations: elevations.length === geometry.length ? elevations : undefined,
      ascentMeters: path.ascend !== undefined ? Math.round(path.ascend) : undefined,
      descentMeters: path.descend !== undefined ? Math.round(path.descend) : undefined,
      routeStartIndex,
    };
  }

  // ── 3. Ranking ─────────────────────────────────────────────────────────────

  /**
   * Turn the measured candidates into the list the UI shows.
   *
   * Three rules, each of which came out of a wrong answer on real data:
   *
   * 1. **Selection respects distance.** Keeping the four *fastest* while
   *    *displaying* by distance silently dropped the nearest road: incident 28
   *    had confirmed asphalt 964 m south, beaten to the last slot by four
   *    north-east points that merely routed quicker.
   * 2. **Spread around the compass.** One corridor used to take every slot, so a
   *    blocked approach left the medic with no alternative.
   * 3. **Drop dominated points.** If the path to B runs past A, B is noise.
   *
   * Usefulness is carried by the `best` flag: the fastest point that can actually
   * be reached, preferring ones the caller can also drive to, since a paved stub
   * no vehicle can get to is worthless however close it is.
   */
  private rank(measured: Measured[], haveCaller: boolean): AsphaltAccessPoint[] {
    const survivors = this.dropDominated(measured);

    // Nearest first, and a point you can actually reach outranks an equidistant
    // one you cannot.
    const byDistance = [...survivors].sort(
      (a, b) => a.straightMeters - b.straightMeters || Number(!routable(a)) - Number(!routable(b)),
    );
    const selected = spreadBySector(byDistance, MAX_POINTS, (m) => m.sector);

    // `best` = fastest reachable of the ones we are showing. Ties go to the
    // nearer road — two points 15 minutes apart by bike are not equivalent when
    // one is 1.2 km away and the other 1.5 km.
    const reachable = selected.filter(routable).sort((a, b) => {
      if (haveCaller) {
        const reach = Number(!a.fromMe) - Number(!b.fromMe);
        if (reach !== 0) return reach;
      }
      // Compare the times the medic actually sees — whole minutes. Raw
      // milliseconds made a road 360 m further away "best" because it routed
      // three seconds quicker, which is noise, not a decision.
      const byTime = displayMinutes(fastestLeg(a)) - displayMinutes(fastestLeg(b));
      if (byTime !== 0) return byTime;
      return a.straightMeters - b.straightMeters;
    });
    const bestPoint = reachable[0];

    return selected
      .sort((a, b) => a.straightMeters - b.straightMeters)
      .map((m, i): AsphaltAccessPoint => {
        const drawable = drawableLeg(m);
        const offPathMeters = drawable?.offPathMeters ?? 0;
        const carry = offPathCarry(offPathMeters);
        const direct = !routable(m);
        return {
          index: i + 1,
          lat: m.point[1],
          lng: m.point[0],
          roadHint: m.roadClass,
          surfaceHint: m.surfaceTag,
          confidence: m.confidence,
          best: m === bestPoint || undefined,
          incident: direct
            ? {
                distanceMeters: m.straightMeters,
                offPathMeters: 0,
                direct: true,
                noRoad: true,
              }
            : {
                distanceMeters: m.foot?.leg.distanceMeters ?? m.bike?.leg.distanceMeters ?? m.straightMeters,
                durationMs: fastestLeg(m),
                offPathMeters,
                offPathSignificant: carry.significant || undefined,
                foot: m.foot?.leg,
                bike: m.bike?.leg,
                direct: false,
              },
          fromMe: m.fromMe,
          path: direct ? undefined : drawable?.path,
        };
      });
  }

  /**
   * Remove candidates you would walk straight past another candidate to reach.
   *
   * A point whose access path runs within {@link DOMINATION_M} of a nearer,
   * reachable point adds nothing — you are already there. Kept anyway if it sits
   * on a materially better road for a vehicle, so a service road on the approach
   * cannot hide the main road behind it.
   */
  private dropDominated(measured: Measured[]): Measured[] {
    const nearestFirst = [...measured].sort((a, b) => a.straightMeters - b.straightMeters);
    const kept: Measured[] = [];

    for (const candidate of nearestFirst) {
      const path = drawableLeg(candidate)?.path.geometry;
      const shadowedBy = path
        ? kept.find(
            (earlier) =>
              routable(earlier) &&
              roadTier(earlier.roadClass) <= roadTier(candidate.roadClass) &&
              path.some((vertex) => distanceBetween(vertex, earlier.point) < DOMINATION_M),
          )
        : undefined;
      if (shadowedBy) {
        this.logger.debug(
          `exit points: dropped ${candidate.roadClass ?? "?"} at ${candidate.straightMeters} m — its path runs past ${shadowedBy.roadClass ?? "?"} at ${shadowedBy.straightMeters} m`,
        );
        continue;
      }
      kept.push(candidate);
    }
    return kept;
  }
}
