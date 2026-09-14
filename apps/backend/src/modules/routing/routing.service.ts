import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { VehicleType } from "@events/contracts";
import { EventsService } from "../events/events.service";
import { buildCorridorModel, type CorridorModel } from "./race-corridor";
import {
  effectiveDurationFactor,
  optionForProfile,
  primaryProfile,
  profileOptions,
  type VehicleProfileOption,
} from "./vehicle-profiles";
import { GraphHopperClient, type GraphHopperPath } from "./graphhopper.client";
import { buildSegments, classifyPoints } from "./surface-classification";
import type {
  LngLat,
  ManeuverKind,
  RouteInstruction,
  RouteProfile,
  RouteResponse,
  RouteSegment,
  RouteVariant,
} from "./routing.types";

const PROFILES: RouteProfile[] = ["foot", "mtb", "car", "rescue_4x4"];

/** GraphHopper instruction sign → maneuver bucket the client renders. */
function maneuverFromSign(sign: number): ManeuverKind {
  switch (sign) {
    case -98:
      return "uturn";
    case -8:
      return "uturn";
    case -7:
      return "keep-left";
    case -3:
      return "turn-sharp-left";
    case -2:
      return "turn-left";
    case -1:
      return "turn-slight-left";
    case 0:
      return "continue";
    case 1:
      return "turn-slight-right";
    case 2:
      return "turn-right";
    case 3:
      return "turn-sharp-right";
    case 4:
      return "arrive";
    case 5:
      return "via";
    case 6:
      return "roundabout";
    case 7:
      return "keep-right";
    default:
      return "continue";
  }
}

/**
 * Turn-by-turn navigation routes.
 *
 * The exit-point ("closest asphalt") search lives in {@link ExitPointsService};
 * both talk to the engine through {@link GraphHopperClient}.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    private readonly eventsService: EventsService,
    private readonly graphhopper: GraphHopperClient,
  ) {}

  /**
   * Everywhere a vehicle can reach from a point within `minutes`, as nested
   * rings — innermost bucket first, and possibly SEVERAL rings per bucket.
   *
   * Several because a vehicle is not one network. An ATV, a motorbike, a 4×4
   * and an offroad ambulance each genuinely choose between the road/track
   * network and the trail network depending on where they are standing, and
   * routing has always measured both and taken the faster. Reach did not: it
   * took only the vehicle's first profile and ignored the rest, so an ATV was
   * quoted a 4×4's reach and silently denied every path it can actually ride.
   * Stand one on a trail and its reach collapses to whatever road the engine
   * snapped to — which is how an ATV ends up looking worse than an e-bike.
   *
   * The engine's own travel time is quoted for its profile, not for this
   * vehicle, so each option's budget is divided by that option's duration
   * factor: a motorbike covering rescue-4×4 ground in 0.8 of the time gets to
   * spend proportionally more of the profile's minutes.
   */
  async isochrone(
    vehicleType: VehicleType,
    point: LngLat,
    minutes: number,
    buckets = 3,
  ): Promise<{ profiles: RouteProfile[]; buckets: LngLat[][][] }> {
    const options = profileOptions(vehicleType);
    const perOption = await Promise.all(
      options.flatMap((option) => {
        const factor = option.durationFactor > 0 ? option.durationFactor : 1;
        const seconds = (minutes * 60) / factor;
        const probes = [
          this.graphhopper
            .isochrone(option.profile, point, { seconds }, buckets)
            .then((rings) => ({ profile: option.profile, rings })),
        ];
        // A vehicle with a speed floor is never as slow as the profile says on
        // a climb. Asking the same question as a DISTANCE budget is exactly
        // that floor, and unioning the two gives the vehicle both its
        // gradient-aware answer and its "a motor does not slow down" one.
        if (option.minSpeedMs) {
          probes.push(
            this.graphhopper
              .isochrone(option.profile, point, { meters: option.minSpeedMs * seconds }, buckets)
              .then((rings) => ({ profile: option.profile, rings })),
          );
        }
        return probes;
      }),
    );

    // Group by bucket: bucket k holds one ring per profile that reached it.
    const grouped: LngLat[][][] = [];
    for (let k = 0; k < buckets; k += 1) {
      const ring = perOption.map((o) => o.rings[k]).filter((r): r is LngLat[] => r != null && r.length >= 4);
      if (ring.length > 0) grouped.push(ring);
    }
    const profiles = [...new Set(perOption.filter((o) => o.rings.length > 0).map((o) => o.profile))];
    return { profiles, buckets: grouped };
  }

  isValidProfile(profile: string): profile is RouteProfile {
    return (PROFILES as string[]).includes(profile);
  }

  /**
   * Compute up to `maxAlternatives` routes between `points` for `profile`.
   *
   * GraphHopper only returns alternatives for point-to-point (2 waypoint)
   * requests; for via-routes (route editing) or profiles where alternatives are
   * unsupported, we fall back to weighting variations so the UI still gets 2–3
   * distinct lines to choose from.
   */
  async route(
    profile: RouteProfile,
    points: LngLat[],
    maxAlternatives: number,
    opts: { eventId?: string; avoidIncomingTraffic?: boolean; vehicleType?: VehicleType } = {},
  ): Promise<RouteResponse> {
    if (points.length < 2) {
      throw new BadRequestException("At least two points are required to build a route.");
    }

    const corridor = await this.resolveCorridor(opts);
    // What this vehicle may drive on, on top of the profile the medic picked.
    // Null when the vehicle has no business on this network at all — the medic
    // asked for it anyway, so route it bare rather than refusing.
    const vehicle = opts.vehicleType ? optionForProfile(opts.vehicleType, profile) : null;

    const wantAlternatives = maxAlternatives > 1 && points.length === 2;
    const variants = wantAlternatives
      ? await this.fetchWithAlternatives(profile, points, maxAlternatives, corridor, vehicle)
      : await this.fetchVariationFallback(profile, points, maxAlternatives, corridor, vehicle);

    return {
      profile,
      waypoints: points,
      routes: variants.map((variant, index) => ({ ...variant, id: String.fromCharCode(65 + index) })),
    };
  }

  /**
   * Load the event's race tracks and turn them into a corridor-avoidance custom
   * model fragment. Returns null when not requested or when the event has no
   * usable tracks (in which case routing proceeds normally — no avoidance).
   */
  private async resolveCorridor(opts: {
    eventId?: string;
    avoidIncomingTraffic?: boolean;
  }): Promise<CorridorModel | null> {
    if (!opts.avoidIncomingTraffic || !opts.eventId) return null;
    try {
      const tracks = await this.eventsService.listTracksForEvent(opts.eventId);
      const lines = tracks
        .map((t) => t.points.map((p): LngLat => [p.lng, p.lat]))
        .filter((line) => line.length >= 2);
      const model = buildCorridorModel(lines);
      if (!model) {
        this.logger.warn(
          `avoid-incoming-traffic requested but event ${opts.eventId} has no usable tracks (${tracks.length} track(s) loaded)`,
        );
      } else {
        this.logger.log(
          `avoid-incoming-traffic: ${model.areas.features.length} corridor area(s) from ${lines.length} track(s) for event ${opts.eventId}`,
        );
      }
      return model;
    } catch (err) {
      // Avoidance is best-effort — never fail the route because of it.
      this.logger.warn(`failed to build race corridor for event ${opts.eventId}: ${String(err)}`);
      return null;
    }
  }

  /** Native GraphHopper alternative_route algorithm (best for 2-point routes). */
  private async fetchWithAlternatives(
    profile: RouteProfile,
    points: LngLat[],
    maxAlternatives: number,
    corridor: CorridorModel | null,
    vehicle: VehicleProfileOption | null,
  ): Promise<Omit<RouteVariant, "id">[]> {
    const body = this.graphhopper.buildBody(profile, points, {
      corridor,
      restrict: vehicle?.restrict ?? null,
      extra: {
        algorithm: "alternative_route",
        "alternative_route.max_paths": Math.min(4, Math.max(2, maxAlternatives)),
        "alternative_route.max_weight_factor": 1.8,
        "alternative_route.max_share_factor": 0.7,
      },
    });

    const paths = await this.graphhopper.route(body);
    return paths.map((path) => this.toVariant(path, vehicle));
  }

  /**
   * Fallback when native alternatives aren't available: re-query with a few
   * `distance_influence` settings (and the rescue custom model) so we still
   * surface a handful of meaningfully different lines, de-duplicated by length.
   */
  private async fetchVariationFallback(
    profile: RouteProfile,
    points: LngLat[],
    maxAlternatives: number,
    corridor: CorridorModel | null,
    vehicle: VehicleProfileOption | null,
  ): Promise<Omit<RouteVariant, "id">[]> {
    const influences = [null, 15, 120].slice(0, Math.max(1, Math.min(3, maxAlternatives)));
    const collected: Omit<RouteVariant, "id">[] = [];
    const seen = new Set<number>();

    for (const influence of influences) {
      const body = this.graphhopper.buildBody(profile, points, { corridor, restrict: vehicle?.restrict ?? null });
      if (influence !== null) {
        const model = (body["custom_model"] as Record<string, unknown> | undefined) ?? {};
        body["custom_model"] = { ...model, distance_influence: influence };
      }
      try {
        const paths = await this.graphhopper.route(body);
        const path = paths[0];
        if (!path) continue;
        const bucket = Math.round(path.distance / 25);
        if (seen.has(bucket)) continue;
        seen.add(bucket);
        collected.push(this.toVariant(path, vehicle));
      } catch (error) {
        // The first variation must succeed; later ones are best-effort.
        if (collected.length === 0) throw error;
        this.logger.warn(`route variation failed: ${String(error)}`);
      }
    }
    return collected;
  }

  private toVariant(path: GraphHopperPath, vehicle: VehicleProfileOption | null): Omit<RouteVariant, "id"> {
    // GraphHopper returns 3D coordinates ([lng, lat, ele]) when elevation is on.
    // Strip to 2D [lng, lat] — native map markers require exactly two values,
    // and ascent/descent come from path.ascend/descend, not the geometry.
    const geometry: LngLat[] = (path.points?.coordinates ?? []).map((c) => [c[0], c[1]]);
    const pointClasses = classifyPoints(geometry.length, path.details);
    const segments: RouteSegment[] = buildSegments(geometry, pointClasses, path.details);
    // A restricting custom model cannot raise the profile's speeds, so the
    // vehicle's own pace is applied here — to the whole route AND to every leg,
    // otherwise the turn-by-turn countdown and the total disagree.
    const factor = effectiveDurationFactor(vehicle, path.time, path.distance);
    const instructions: RouteInstruction[] = (path.instructions ?? []).map((raw) => {
      const at = geometry[raw.interval?.[0] ?? 0];
      return {
        text: raw.text,
        maneuver: maneuverFromSign(raw.sign),
        sign: raw.sign,
        distanceMeters: raw.distance,
        timeMs: Math.round(raw.time * factor),
        streetName: raw.street_name || undefined,
        exitNumber:
          typeof raw.exit_number === "number" && raw.exit_number > 0 ? raw.exit_number : undefined,
        interval: raw.interval,
        location: at,
      };
    });

    return {
      distanceMeters: path.distance,
      durationMs: Math.round(path.time * factor),
      ascentMeters: path.ascend,
      descentMeters: path.descend,
      geometry,
      segments,
      instructions,
    };
  }
}
