import { BadGatewayException, BadRequestException, Injectable, Logger } from "@nestjs/common";
import { EventsService } from "../events/events.service";
import { RESCUE_4X4_CUSTOM_MODEL } from "./rescue-custom-model";
import { buildCorridorModel, mergeCustomModel, type CorridorModel } from "./race-corridor";
import { buildSegments, classifyPoints, type PathDetails } from "./surface-classification";
import type {
  LngLat,
  ManeuverKind,
  RouteInstruction,
  RouteProfile,
  RouteResponse,
  RouteVariant,
} from "./routing.types";

const PROFILES: RouteProfile[] = ["foot", "mtb", "car", "rescue_4x4"];

/** GraphHopper path_details we request for surface classification. */
const REQUESTED_DETAILS = ["road_class", "surface", "track_type", "road_environment"];

/** Map our app profile → the GraphHopper profile name to send. */
function graphhopperProfile(profile: RouteProfile): string {
  if (profile === "rescue_4x4") {
    // When GraphHopper is configured with a native rescue profile, use it
    // directly; otherwise ride on the `car` profile + inline custom model.
    return process.env.GRAPHHOPPER_NATIVE_RESCUE === "true"
      ? "rescue_4x4"
      : (process.env.GRAPHHOPPER_RESCUE_BASE_PROFILE ?? "car");
  }
  return profile;
}

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

interface GraphHopperPath {
  distance: number;
  time: number;
  ascend?: number;
  descend?: number;
  points: { coordinates: LngLat[] };
  details?: PathDetails;
  instructions?: Array<{
    text: string;
    distance: number;
    time: number;
    sign: number;
    street_name?: string;
    interval: [number, number];
  }>;
}

@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);
  private readonly baseUrl = (process.env.GRAPHHOPPER_URL ?? "http://localhost:8989").replace(/\/$/, "");
  private readonly apiKey = process.env.GRAPHHOPPER_API_KEY?.trim();

  constructor(private readonly eventsService: EventsService) {}

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
    opts: { eventId?: string; avoidIncomingTraffic?: boolean } = {},
  ): Promise<RouteResponse> {
    if (points.length < 2) {
      throw new BadRequestException("At least two points are required to build a route.");
    }

    const corridor = await this.resolveCorridor(opts);

    const wantAlternatives = maxAlternatives > 1 && points.length === 2;
    const variants = wantAlternatives
      ? await this.fetchWithAlternatives(profile, points, maxAlternatives, corridor)
      : await this.fetchVariationFallback(profile, points, maxAlternatives, corridor);

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
  ): Promise<Omit<RouteVariant, "id">[]> {
    const body = this.baseRequest(profile, points, corridor);
    body["algorithm"] = "alternative_route";
    body["alternative_route.max_paths"] = Math.min(4, Math.max(2, maxAlternatives));
    body["alternative_route.max_weight_factor"] = 1.8;
    body["alternative_route.max_share_factor"] = 0.7;

    const paths = await this.callGraphHopper(body);
    return paths.map((path) => this.toVariant(path));
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
  ): Promise<Omit<RouteVariant, "id">[]> {
    const influences = [null, 15, 120].slice(0, Math.max(1, Math.min(3, maxAlternatives)));
    const collected: Omit<RouteVariant, "id">[] = [];
    const seen = new Set<number>();

    for (const influence of influences) {
      const body = this.baseRequest(profile, points, corridor);
      if (influence !== null) {
        const model = (body["custom_model"] as Record<string, unknown> | undefined) ?? {};
        body["custom_model"] = { ...model, distance_influence: influence };
        body["ch.disable"] = true;
      }
      try {
        const paths = await this.callGraphHopper(body);
        const path = paths[0];
        if (!path) continue;
        const bucket = Math.round(path.distance / 25);
        if (seen.has(bucket)) continue;
        seen.add(bucket);
        collected.push(this.toVariant(path));
      } catch (error) {
        // The first variation must succeed; later ones are best-effort.
        if (collected.length === 0) throw error;
        this.logger.warn(`route variation failed: ${String(error)}`);
      }
    }
    return collected;
  }

  private baseRequest(
    profile: RouteProfile,
    points: LngLat[],
    corridor: CorridorModel | null = null,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      profile: graphhopperProfile(profile),
      points,
      points_encoded: false,
      instructions: true,
      elevation: true,
      details: REQUESTED_DETAILS,
      locale: "en",
      // Our self-hosted GraphHopper runs flexible (no CH/LM prep), so every
      // request must disable CH. Harmless against a CH-prepared instance too.
      "ch.disable": true,
    };
    // When GraphHopper has no native rescue profile, ride on the base profile and
    // send the rescue shaping as an inline custom model instead.
    if (profile === "rescue_4x4" && process.env.GRAPHHOPPER_NATIVE_RESCUE !== "true") {
      body["custom_model"] = { ...RESCUE_4X4_CUSTOM_MODEL };
    }
    // "Avoid incoming traffic": merge the race-corridor penalty into whatever
    // custom model is already on the request (rescue inline, or none). A custom
    // model requires ch.disable, which is always set above.
    if (corridor) {
      body["custom_model"] = mergeCustomModel(body["custom_model"] as Record<string, unknown> | undefined, corridor);
    }
    return body;
  }

  private async callGraphHopper(body: Record<string, unknown>): Promise<GraphHopperPath[]> {
    const url = `${this.baseUrl}/route${this.apiKey ? `?key=${this.apiKey}` : ""}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      this.logger.error(`GraphHopper unreachable at ${this.baseUrl}: ${String(error)}`);
      throw new BadGatewayException("Routing engine is unreachable.");
    }

    const text = await response.text();
    if (!response.ok) {
      this.logger.warn(`GraphHopper ${response.status}: ${text.slice(0, 300)}`);
      // GraphHopper reports "no route" / point-not-found as 400 with a message.
      throw new BadGatewayException(
        this.extractMessage(text) ?? `Routing engine error (${response.status}).`,
      );
    }

    const parsed = JSON.parse(text) as { paths?: GraphHopperPath[] };
    if (!parsed.paths || parsed.paths.length === 0) {
      throw new BadGatewayException("No route found between the selected points.");
    }
    return parsed.paths;
  }

  private extractMessage(text: string): string | undefined {
    try {
      const parsed = JSON.parse(text) as { message?: string };
      return parsed.message;
    } catch {
      return undefined;
    }
  }

  private toVariant(path: GraphHopperPath): Omit<RouteVariant, "id"> {
    // GraphHopper returns 3D coordinates ([lng, lat, ele]) when elevation is on.
    // Strip to 2D [lng, lat] — native map markers require exactly two values,
    // and ascent/descent come from path.ascend/descend, not the geometry.
    const geometry: LngLat[] = (path.points?.coordinates ?? []).map((c) => [c[0], c[1]]);
    const pointClasses = classifyPoints(geometry.length, path.details);
    const segments = buildSegments(geometry, pointClasses, path.details);
    const instructions: RouteInstruction[] = (path.instructions ?? []).map((raw) => {
      const at = geometry[raw.interval?.[0] ?? 0];
      return {
        text: raw.text,
        maneuver: maneuverFromSign(raw.sign),
        sign: raw.sign,
        distanceMeters: raw.distance,
        timeMs: raw.time,
        streetName: raw.street_name || undefined,
        interval: raw.interval,
        location: at,
      };
    });

    return {
      distanceMeters: path.distance,
      durationMs: path.time,
      ascentMeters: path.ascend,
      descentMeters: path.descend,
      geometry,
      segments,
      instructions,
    };
  }
}
