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

/** Probe directions per ring. Odd rings are offset half a step so the union of
 *  two rings covers 24 distinct bearings without paying for 24 every time. */
const BEARINGS_PER_RING = 12;

/** Stop expanding once this many distinct roads are on the table. */
const ENOUGH_CANDIDATES = 6;

/** Two candidates closer than this are the same piece of road. */
const DEDUPE_M = 220;

/** How many of the nearest candidates get the full routing treatment. */
const MEASURE_LIMIT = 8;

const MAX_ROUTED = 4;
/** Straight-line points shown alongside routed ones — more when nothing routed. */
const MAX_DIRECT = 2;
const MAX_DIRECT_WHEN_NOTHING_ROUTED = 4;

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
  confidence: PavedConfidence;
  roadClass?: string;
  surfaceTag?: string;
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

  /** The points the circle hits first — biased slightly towards trusted surfaces. */
  private shortlist(candidates: Candidate[]): Candidate[] {
    return [...candidates]
      .sort(
        (a, b) =>
          a.straightMeters * CONFIDENCE_BIAS[a.confidence] - b.straightMeters * CONFIDENCE_BIAS[b.confidence],
      )
      .slice(0, MEASURE_LIMIT);
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
   * Order the measured candidates into the list the UI shows.
   *
   * The list is ordered by how close the road actually is — the order the
   * expanding circle reached them. Sorting by travel time instead buried the
   * genuinely useful answers: on the Musala ridge a road 5.2 km away with a
   * two-minute ambulance drive came out *below* one 8.9 km away that happened to
   * have a walkable route, because 130 minutes of walking beat "no route".
   *
   * Usefulness is carried by the `best` flag instead: the fastest point that can
   * actually be reached, preferring ones the caller can also drive to, since a
   * paved stub no vehicle can get to is worthless however close it is.
   */
  private rank(measured: Measured[], haveCaller: boolean): AsphaltAccessPoint[] {
    const fastest = (m: Measured): number | undefined => {
      const times = [m.foot?.leg.durationMs, m.bike?.leg.durationMs].filter(
        (t): t is number => typeof t === "number",
      );
      return times.length > 0 ? Math.min(...times) : undefined;
    };

    const routed = measured
      .filter((m) => m.foot !== null || m.bike !== null)
      .sort((a, b) => {
        if (haveCaller) {
          const reach = Number(!a.fromMe) - Number(!b.fromMe);
          if (reach !== 0) return reach;
        }
        return (fastest(a) ?? Infinity) - (fastest(b) ?? Infinity);
      })
      .slice(0, MAX_ROUTED);

    // Straight-line points exist for exactly one reason: asphalt that is close
    // but has no walkable route to it at all. A routed candidate that merely
    // missed the top four is not shown as "direct" — pairing a crow-flies
    // distance with a path-following duration is how the old list ended up
    // contradicting itself.
    const direct = measured
      .filter((m) => m.foot === null && m.bike === null)
      .sort((a, b) => a.straightMeters - b.straightMeters)
      // When nothing routed at all, these are the only answers there are —
      // show more of them rather than leaving the medic with two.
      .slice(0, routed.length === 0 ? MAX_DIRECT_WHEN_NOTHING_ROUTED : MAX_DIRECT);

    const bestPoint = routed[0];

    const asRouted = routed.map((m): AsphaltAccessPoint => {
      const drawable = drawableLeg(m);
      const offPathMeters = drawable?.offPathMeters ?? 0;
      const carry = offPathCarry(offPathMeters);
      return {
        index: 0,
        lat: m.point[1],
        lng: m.point[0],
        roadHint: m.roadClass,
        surfaceHint: m.surfaceTag,
        confidence: m.confidence,
        best: m === bestPoint,
        incident: {
          distanceMeters: m.foot?.leg.distanceMeters ?? m.bike?.leg.distanceMeters ?? m.straightMeters,
          durationMs: fastest(m),
          offPathMeters,
          offPathSignificant: carry.significant || undefined,
          foot: m.foot?.leg,
          bike: m.bike?.leg,
          direct: false,
        },
        fromMe: m.fromMe,
        path: drawable?.path,
      };
    });

    const asDirect = direct.map((m): AsphaltAccessPoint => ({
      index: 0,
      lat: m.point[1],
      lng: m.point[0],
      roadHint: m.roadClass,
      surfaceHint: m.surfaceTag,
      confidence: m.confidence,
      incident: {
        distanceMeters: m.straightMeters,
        offPathMeters: 0,
        direct: true,
        noRoad: true,
      },
      fromMe: m.fromMe,
    }));

    // Numbered by proximity to the casualty, routed and unroutable interleaved.
    const straightOf = new Map<AsphaltAccessPoint, number>();
    for (const [list, source] of [
      [asRouted, routed],
      [asDirect, direct],
    ] as const) {
      list.forEach((point, i) => straightOf.set(point, source[i].straightMeters));
    }
    return [...asRouted, ...asDirect]
      .sort((a, b) => (straightOf.get(a) ?? 0) - (straightOf.get(b) ?? 0))
      .map((point, i) => ({ ...point, index: i + 1 }));
  }
}
