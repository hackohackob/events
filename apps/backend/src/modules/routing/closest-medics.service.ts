import { Injectable, Logger } from "@nestjs/common";
import {
  CLOSEST_MEDIC_LIMIT,
  DEFAULT_VEHICLE_TYPE,
  type ClosestMedic,
  type ClosestMedicsResponse,
  type MedicState,
  type VehicleType,
} from "@events/contracts";
import { MedicsService } from "../medics/medics.service";
import { IncidentsService } from "../incidents/incidents.service";
import { GraphHopperClient, type GraphHopperPath } from "./graphhopper.client";
import { buildSegments, classifyPoints } from "./surface-classification";
import { distanceBetween } from "./geo";
import { effectiveDurationFactor, VEHICLE_DIRECT_SPEED_MS, VEHICLE_PROFILES } from "./vehicle-profiles";
import type { LngLat } from "./routing.types";

/**
 * How many of the nearest-by-air medics we actually route. Routing is the
 * expensive part, so we take a generous crow-flies shortlist (a medic 2 km away
 * on the wrong side of a river loses to one 4 km away on a road) but not the
 * whole roster.
 */
const ROUTE_CANDIDATES = 12;

/**
 * Medics further out than this in a straight line are not plausible responders
 * and are dropped before any routing happens.
 */
const MAX_SEARCH_METERS = 60_000;

/** Drawn lines don't need every vertex; thin long geometries. */
const MAX_VERTICES = 220;

interface Candidate {
  state: MedicState;
  vehicleType: VehicleType;
  straightMeters: number;
}

/**
 * "Closest medic": rank the team by how long each of them would actually take
 * to reach an incident, routed on their own vehicle's network rather than by
 * crow-flies distance.
 *
 * Medics in `rest` are deliberately still ranked — a coordinator sometimes has
 * to wake someone, and hiding them would hide that they were the only option.
 * The client shows the warning.
 */
@Injectable()
export class ClosestMedicsService {
  private readonly logger = new Logger(ClosestMedicsService.name);

  constructor(
    private readonly medics: MedicsService,
    private readonly incidents: IncidentsService,
    private readonly graphhopper: GraphHopperClient,
  ) {}

  async closestMedics(
    eventId: string,
    origin: LngLat,
    opts: { incidentId?: string; excludeMedicId?: string } = {},
  ): Promise<ClosestMedicsResponse> {
    const [active, roster, responders] = await Promise.all([
      this.medics.getActiveMedics(eventId),
      this.medics.getMedicRoster(eventId),
      opts.incidentId
        ? this.incidents.getResponders(eventId, opts.incidentId).catch(() => [] as string[])
        : Promise.resolve([] as string[]),
    ]);

    const locatable = active.filter(
      (m) => Number.isFinite(m.lat) && Number.isFinite(m.lng) && m.medicId !== opts.excludeMedicId,
    );

    const candidates: Candidate[] = locatable
      .map((state) => ({
        state,
        vehicleType: state.vehicleType ?? DEFAULT_VEHICLE_TYPE,
        straightMeters: distanceBetween(origin, [state.lng, state.lat]),
      }))
      .filter((c) => c.straightMeters <= MAX_SEARCH_METERS)
      .sort((a, b) => a.straightMeters - b.straightMeters)
      .slice(0, ROUTE_CANDIDATES);

    const measured = await Promise.all(candidates.map((c) => this.measure(origin, c)));

    // Rank by real travel time. Routed legs always beat straight-line estimates
    // at the same duration — a measured 12 min is worth more than a guessed one.
    const ranked = measured
      .sort((a, b) => (a.direct === b.direct ? a.durationMs - b.durationMs : a.direct ? 1 : -1))
      .slice(0, CLOSEST_MEDIC_LIMIT)
      .map((m, index) => ({ ...m, rank: index, assigned: responders.includes(m.medicId) }));

    return {
      origin: { lat: origin[1], lng: origin[0] },
      medics: ranked,
      // Roster entries that have never reported a position — they cannot be
      // ranked, and the client says so rather than pretending the team is
      // smaller than it is.
      unlocatedCount: Math.max(0, roster.length - active.length),
    };
  }

  /**
   * Route one medic → incident. Vehicles that can genuinely choose between the
   * road network and the trail network (motorbikes, quads, 4×4s) are measured
   * on both and the faster answer wins — averaging them would describe neither.
   */
  private async measure(origin: LngLat, candidate: Candidate): Promise<Omit<ClosestMedic, "rank" | "assigned">> {
    const { state, vehicleType } = candidate;
    const from: LngLat = [state.lng, state.lat];
    const options = VEHICLE_PROFILES[vehicleType] ?? VEHICLE_PROFILES.foot;

    const measured = await Promise.all(
      options.map(async (option) => {
        const path = await this.graphhopper.tryRoute(option.profile, [from, origin], {
          instructions: false,
          elevation: false,
          details: true,
          restrict: option.restrict ?? null,
        });
        if (!path) return null;
        const factor = effectiveDurationFactor(option, path.time, path.distance);
        return { option, path, durationMs: Math.round(path.time * factor) };
      }),
    );

    const best = measured
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => a.durationMs - b.durationMs)[0];

    const base = {
      medicId: state.medicId,
      name: state.name,
      status: state.status,
      vehicleType,
      lat: state.lat,
      lng: state.lng,
      lastSeenAt: state.lastSeenAt,
      battery: state.battery,
    };

    if (!best) {
      this.logger.debug(
        `closest medics: no ${vehicleType} route for ${state.name} on ${options
          .map((o) => o.profile)
          .join("/")}, estimating straight-line`,
      );
      const speed = VEHICLE_DIRECT_SPEED_MS[vehicleType] ?? VEHICLE_DIRECT_SPEED_MS.foot;
      return {
        ...base,
        distanceMeters: Math.round(candidate.straightMeters),
        durationMs: Math.round((candidate.straightMeters / speed) * 1000),
        direct: true,
        route: null,
      };
    }

    return {
      ...base,
      distanceMeters: Math.round(best.path.distance),
      durationMs: best.durationMs,
      direct: false,
      route: this.toRoute(best.path),
    };
  }

  /** GraphHopper path → the surface-classified line the map draws. */
  private toRoute(path: GraphHopperPath): ClosestMedic["route"] {
    const raw = path.points?.coordinates ?? [];
    const step = raw.length > MAX_VERTICES ? Math.ceil(raw.length / MAX_VERTICES) : 1;
    const geometry: LngLat[] = [];
    // Thinning must keep the classification aligned, so the point classes are
    // computed on the full geometry and sampled with the same stride.
    const fullClasses = classifyPoints(raw.length, path.details);
    const classes: ReturnType<typeof classifyPoints> = [];

    for (let i = 0; i < raw.length; i += step) {
      geometry.push([raw[i][0], raw[i][1]]);
      classes.push(fullClasses[i]);
    }
    const last = raw[raw.length - 1];
    const tail = geometry[geometry.length - 1];
    if (last && (!tail || tail[0] !== last[0] || tail[1] !== last[1])) {
      geometry.push([last[0], last[1]]);
      classes.push(fullClasses[raw.length - 1]);
    }
    if (geometry.length < 2) return null;

    // `details` intervals index the *unthinned* path, so they are not passed on
    // — the sampled point classes already carry the surface information.
    return { geometry, segments: buildSegments(geometry, classes) };
  }
}
