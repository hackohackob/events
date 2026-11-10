import { Injectable, Logger } from "@nestjs/common";
import type { SnapProfile, SnapLineResponse } from "@events/contracts";
import { distanceBetween } from "./geo";
import { GraphHopperClient, type GraphHopperPath } from "./graphhopper.client";
import type { LngLat } from "./routing.types";

/**
 * How far a waypoint may be dragged to reach the network before the answer is
 * "there is no road here". Past this the engine is not snapping a sketch, it is
 * inventing a different line — and on a mountain the nearest mapped way to an
 * unmapped gully is usually on the other side of a ridge.
 */
const MAX_SNAP_M = 180;

/**
 * A multi-point sketch that routes to much more than its own length did not
 * follow a road: one of its waypoints landed on a side track and the engine
 * drove out to it and back. The slack term keeps short strokes — where a single
 * switchback doubles the distance — from being rejected.
 */
const SKETCH_DETOUR_FACTOR = 2.4;
const SKETCH_DETOUR_SLACK_M = 300;

function lineLength(points: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distanceBetween(points[i - 1]!, points[i]!);
  return total;
}

/**
 * Pulls a rough, hand-drawn line onto the road/path network.
 *
 * GraphHopper's /route is used as the matcher, the same way the planner's
 * Access view does it: the sketch is reduced to a handful of waypoints and the
 * engine is asked for the way through them. That needs no map-matching build of
 * the graph, and for the two things the dashboard asks — "the road between
 * these two clicks" and "the track I just traced" — it is the same answer.
 *
 * Every failure degrades to the line as drawn, with a reason. A coordinator
 * marking a way round a rockfall must never be stopped by the routing engine.
 */
@Injectable()
export class LineSnapService {
  private readonly logger = new Logger(LineSnapService.name);

  constructor(private readonly graphhopper: GraphHopperClient) {}

  async snap(points: LngLat[], profile: SnapProfile): Promise<SnapLineResponse> {
    const drawnMeters = lineLength(points);
    const asDrawn = (reason: SnapLineResponse["reason"]): SnapLineResponse => ({
      snapped: false,
      coordinates: points,
      distanceMeters: Math.round(drawnMeters),
      reason,
    });

    let path: GraphHopperPath | undefined;
    try {
      // pass_through keeps the engine from U-turning at a via point — without
      // it a waypoint a few metres down a side track becomes a visible spur.
      path = (await this.route(points, profile, points.length > 2))[0];
    } catch (first) {
      if (isUnreachable(first)) return asDrawn("engine_unavailable");
      if (isPointNotFound(first)) return asDrawn("no_road_nearby");
      if (points.length <= 2) return asDrawn("no_route");
      // pass_through can make a fine request unroutable (a via point at a dead
      // end has no way onward without turning round) — try once without it.
      try {
        path = (await this.route(points, profile, false))[0];
      } catch (second) {
        return asDrawn(isPointNotFound(second) ? "no_road_nearby" : "no_route");
      }
    }
    if (!path || path.points.coordinates.length < 2) return asDrawn("no_route");

    const landed = path.snapped_waypoints?.coordinates ?? [];
    for (let i = 0; i < points.length && i < landed.length; i += 1) {
      const at = landed[i]!;
      if (distanceBetween(points[i]!, [at[0]!, at[1]!]) > MAX_SNAP_M) return asDrawn("no_road_nearby");
    }

    if (points.length > 2 && path.distance > drawnMeters * SKETCH_DETOUR_FACTOR + SKETCH_DETOUR_SLACK_M) {
      this.logger.debug(
        `sketch of ${Math.round(drawnMeters)} m routed to ${Math.round(path.distance)} m — left as drawn`,
      );
      return asDrawn("no_route");
    }

    return {
      snapped: true,
      coordinates: path.points.coordinates.map(([lng, lat]) => [lng!, lat!] as [number, number]),
      distanceMeters: Math.round(path.distance),
    };
  }

  private route(points: LngLat[], profile: SnapProfile, passThrough: boolean): Promise<GraphHopperPath[]> {
    return this.graphhopper.route(
      this.graphhopper.buildBody(profile, points, {
        instructions: false,
        elevation: false,
        details: false,
        extra: passThrough ? { pass_through: true } : undefined,
      }),
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUnreachable(error: unknown): boolean {
  return /unreachable/i.test(messageOf(error));
}

/** GraphHopper's "Cannot find point 2: 42.1,23.4" — a waypoint off the network. */
function isPointNotFound(error: unknown): boolean {
  return /cannot find point|point .* out of bounds/i.test(messageOf(error));
}
