import { BadGatewayException, Injectable, Logger } from "@nestjs/common";
import { RESCUE_4X4_CUSTOM_MODEL } from "./rescue-custom-model";
import { mergeCustomModel, type CorridorModel } from "./race-corridor";
import type { PathDetails } from "./surface-classification";
import type { LngLat, RouteProfile } from "./routing.types";

/** GraphHopper `path_details` we request for surface classification. */
export const REQUESTED_DETAILS = ["road_class", "surface", "track_type", "road_environment", "road_access"];

export interface GraphHopperPath {
  distance: number;
  time: number;
  ascend?: number;
  descend?: number;
  /** `[lng, lat]`, or `[lng, lat, ele]` when the request asked for elevation. */
  points: { coordinates: number[][] };
  /**
   * Where GraphHopper actually snapped each requested waypoint. This is how far
   * the caller's coordinate was from the routable network — the "hidden" first
   * leg that a route silently teleports across.
   */
  snapped_waypoints?: { coordinates: number[][] };
  details?: PathDetails;
  instructions?: Array<{
    text: string;
    distance: number;
    time: number;
    sign: number;
    street_name?: string;
    /** Roundabout instructions (sign 6) carry the 1-based exit to take. */
    exit_number?: number;
    interval: [number, number];
  }>;
}

export interface GraphHopperRequestOptions {
  /** Turn-by-turn text. Off for probe/measurement calls — it is pure payload. */
  instructions?: boolean;
  /** Ask for 3D coordinates + ascend/descend. */
  elevation?: boolean;
  /** Request `path_details` for surface classification. */
  details?: boolean;
  /** Race-corridor avoidance model to merge into the request. */
  corridor?: CorridorModel | null;
  /**
   * Extra custom-model rules narrowing the base profile to one specific
   * vehicle (see `vehicle-profiles.ts`). GraphHopper only lets a request-level
   * custom model *restrict* the profile — never widen it — so the base profile
   * must already be the most permissive network the vehicle can legally use.
   */
  restrict?: Record<string, unknown> | null;
  /**
   * Keep GraphHopper from snapping a waypoint onto these road classes — an
   * incident beside a motorway must not snap onto the carriageway itself.
   */
  snapPrevention?: string[];
  /** Extra raw body fields (algorithm, alternatives, custom_model tweaks…). */
  extra?: Record<string, unknown>;
}

/**
 * Concatenate the `priority` and `speed` rule lists of two custom models,
 * with `extra` applied last so its blocks win. Any other key (e.g.
 * `distance_influence`) is taken from `extra` when present.
 */
function stackCustomModel(
  base: Record<string, unknown> | undefined,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  return {
    ...(base ?? {}),
    ...extra,
    priority: [...asList(base?.priority), ...asList(extra.priority)],
    speed: [...asList(base?.speed), ...asList(extra.speed)],
  };
}

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

/**
 * Thin transport around the self-hosted GraphHopper HTTP API.
 *
 * Owns the base URL, the API key, profile mapping and the rescue/corridor custom
 * models, so both the navigation routes and the exit-point search speak to the
 * engine through one place and cannot drift apart.
 */
@Injectable()
export class GraphHopperClient {
  private readonly logger = new Logger(GraphHopperClient.name);
  private readonly baseUrl = (process.env.GRAPHHOPPER_URL ?? "http://localhost:8989").replace(/\/$/, "");
  private readonly apiKey = process.env.GRAPHHOPPER_API_KEY?.trim();

  /** Build the request body for a route, without sending it. */
  buildBody(profile: RouteProfile, points: LngLat[], opts: GraphHopperRequestOptions = {}): Record<string, unknown> {
    const body: Record<string, unknown> = {
      profile: graphhopperProfile(profile),
      points,
      points_encoded: false,
      instructions: opts.instructions ?? true,
      elevation: opts.elevation ?? true,
      locale: "en",
      // Our self-hosted GraphHopper runs flexible (no CH/LM prep), so every
      // request must disable CH. Harmless against a CH-prepared instance too.
      "ch.disable": true,
    };
    if (opts.details ?? true) body["details"] = REQUESTED_DETAILS;
    if (opts.snapPrevention?.length) body["snap_prevention"] = opts.snapPrevention;

    // When GraphHopper has no native rescue profile, ride on the base profile and
    // send the rescue shaping as an inline custom model instead.
    if (profile === "rescue_4x4" && process.env.GRAPHHOPPER_NATIVE_RESCUE !== "true") {
      body["custom_model"] = { ...RESCUE_4X4_CUSTOM_MODEL };
    }
    // Vehicle restriction (what THIS vehicle may drive on) stacks onto whatever
    // model the profile already carries.
    if (opts.restrict) {
      body["custom_model"] = stackCustomModel(
        body["custom_model"] as Record<string, unknown> | undefined,
        opts.restrict,
      );
    }
    // "Avoid incoming traffic": merge the race-corridor penalty into whatever
    // custom model is already on the request. A custom model requires
    // ch.disable, which is always set above.
    if (opts.corridor) {
      body["custom_model"] = mergeCustomModel(body["custom_model"] as Record<string, unknown> | undefined, opts.corridor);
    }
    return { ...body, ...(opts.extra ?? {}) };
  }

  /** POST /route, throwing a BadGateway on any engine-level failure. */
  async route(body: Record<string, unknown>): Promise<GraphHopperPath[]> {
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
      throw new BadGatewayException(this.extractMessage(text) ?? `Routing engine error (${response.status}).`);
    }

    const parsed = JSON.parse(text) as { paths?: GraphHopperPath[] };
    if (!parsed.paths || parsed.paths.length === 0) {
      throw new BadGatewayException("No route found between the selected points.");
    }
    return parsed.paths;
  }

  /**
   * Best-effort single path. Returns null instead of throwing — the exit-point
   * search fires dozens of speculative probes where "no route that way" is a
   * normal, expected answer rather than an error.
   */
  async tryRoute(
    profile: RouteProfile,
    points: LngLat[],
    opts: GraphHopperRequestOptions = {},
  ): Promise<GraphHopperPath | null> {
    try {
      const paths = await this.route(this.buildBody(profile, points, opts));
      return paths[0] ?? null;
    } catch {
      return null;
    }
  }

  private extractMessage(text: string): string | undefined {
    try {
      return (JSON.parse(text) as { message?: string }).message;
    } catch {
      return undefined;
    }
  }
}
