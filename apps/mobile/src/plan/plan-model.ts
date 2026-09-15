import type { EventPlan, PlanDisciplineSchedule, PlanMedic, PlanStation, VehicleType } from "@events/contracts";
import { planSweeps } from "@events/contracts";
import {
  buildCourse,
  buildFieldShape,
  fieldAt,
  legVehicle,
  nearestOnCourse,
  plannedStations,
  pointAtMeters,
  resolveMedicTimeline,
  resolveSweep,
  scheduleEndMs,
  timeFractionAtMeters,
  DEFAULT_MIN_TRAVEL_MINUTES,
  type CourseModel,
  type FieldShape,
  type MedicTimeline,
  type ResolvedSweep,
  type SweepWindow,
} from "@events/planner";
import type { PlanTrack } from "./plan-api";

/** Fallback palette for a course whose discipline never got a colour. */
const COURSE_FALLBACK_COLORS = ["#38bdf8", "#f97316", "#a78bfa", "#34d399", "#f472b6"];

export interface PlanCourse {
  id: string;
  label: string;
  color: string;
  course: CourseModel;
  schedule: PlanDisciplineSchedule;
  shape: FieldShape;
  hasCourse: boolean;
  enabled: boolean;
}

/** The name half of a `${dayDate}::${name}` discipline key. */
export function disciplineName(disciplineId: string): string {
  const cut = disciplineId.indexOf("::");
  return cut >= 0 ? disciplineId.slice(cut + 2) : disciplineId;
}

/**
 * Pair each schedule in the plan with the course it belongs to.
 *
 * Tracks carry their own `disciplineId` now, but a plan written before that
 * existed — or an event whose tracks come from the example set — only has the
 * label to go on, so the name is tried as a second key.
 */
export function buildPlanCourses(plan: EventPlan | null, tracks: PlanTrack[]): PlanCourse[] {
  if (!plan) return [];
  return plan.disciplines.map((schedule, index) => {
    const name = disciplineName(schedule.id);
    const track =
      tracks.find((t) => t.disciplineId === schedule.id) ??
      tracks.find((t) => t.label === name);
    const points = track?.points ?? [];
    const course = buildCourse(
      points.map((p) => [p.lng, p.lat] as [number, number]),
      points.map((p) => p.ele ?? 0),
    );
    return {
      id: schedule.id,
      label: name,
      color: track?.color ?? COURSE_FALLBACK_COLORS[index % COURSE_FALLBACK_COLORS.length],
      course,
      schedule,
      shape: buildFieldShape(schedule),
      hasCourse: course.coordinates.length > 1,
      enabled: schedule.enabled !== false,
    };
  });
}

/**
 * Each course expanded into something a sweep can be resolved against. A
 * straight port of the desk's version — the two must agree on when the tail
 * passes a post, or the same plan would put a sweeper on the course at two
 * different times depending on which screen is reading it.
 */
export function buildSweepWindows(courses: PlanCourse[]): Record<string, SweepWindow> {
  const out: Record<string, SweepWindow> = {};
  for (const d of courses) {
    if (!d.hasCourse || !d.enabled) continue;
    const gunMs = new Date(d.schedule.startAt).getTime();
    if (!Number.isFinite(gunMs)) continue;
    const coords = d.course.coordinates;
    const terrain = (d.schedule.pacing ?? "terrain") === "terrain";
    const waveOffset = d.schedule.startWindowMinutes ?? 0;
    out[d.id] = {
      disciplineId: d.id,
      label: d.label,
      color: d.color,
      gunMs,
      endMs: scheduleEndMs(d.schedule),
      courseStart: coords[0],
      endPoint: coords[coords.length - 1],
      positionAt: (atMs: number) => {
        const state = fieldAt(d.schedule, d.shape, d.course, atMs);
        if (state.onCourse <= 0 || state.tailMeters < 0) {
          return atMs <= gunMs ? coords[0] : coords[coords.length - 1];
        }
        return pointAtMeters(d.course, state.tailMeters);
      },
      tailReaches: (point: [number, number]) => {
        const { meters } = nearestOnCourse(d.course, point);
        const fraction = timeFractionAtMeters(d.course, meters, terrain);
        return gunMs + (waveOffset + d.schedule.slowestMinutes * fraction) * 60000;
      },
    };
  }
  return out;
}

export function sweepsForMedic(
  medic: PlanMedic,
  windows: Record<string, SweepWindow>,
): ResolvedSweep[] {
  return planSweeps(medic)
    .map((assignment) => {
      const window = windows[assignment.disciplineId];
      return window ? resolveSweep(medic, window, assignment.joinFrom) : null;
    })
    .filter((s): s is ResolvedSweep => s != null)
    .sort((a, b) => a.startMs - b.startMs);
}

/** Cache key for one routed leg. Vias are part of it: bend the route and it is
 *  a different journey, so the drawn line has to be re-asked for. */
export function legKey(from: PlanStation, to: PlanStation, vehicle: VehicleType): string {
  const vias = (to.via ?? []).map((v) => `${v.lng.toFixed(5)},${v.lat.toFixed(5)}`).join("|");
  return `${from.lng.toFixed(5)},${from.lat.toFixed(5)}>${to.lng.toFixed(5)},${to.lat.toFixed(5)}@${vehicle}#${vias}`;
}

export interface MedicPlan {
  medic: PlanMedic;
  timeline: MedicTimeline;
  sweeps: ResolvedSweep[];
}

export function resolveMedicPlans(
  plan: EventPlan | null,
  windows: Record<string, SweepWindow>,
  paths: Map<string, [number, number][]>,
): MedicPlan[] {
  if (!plan) return [];
  const minTravelMinutes = plan.settings?.minTravelMinutes ?? DEFAULT_MIN_TRAVEL_MINUTES;
  return plan.medics
    .filter((m) => !m.hidden)
    .map((medic) => {
      const sweeps = sweepsForMedic(medic, windows);
      const timeline = resolveMedicTimeline(medic, {
        minTravelMinutes,
        sweeps,
        paths: (from, to, vehicle) => paths.get(legKey(from, to, vehicle)),
      });
      return { medic, timeline, sweeps };
    });
}

/** Every leg the map would like drawn along real roads, newest plan first. */
export function legsToRoute(
  plan: EventPlan | null,
  windows: Record<string, SweepWindow>,
): Array<{ from: PlanStation; to: PlanStation; vehicle: VehicleType; key: string }> {
  if (!plan) return [];
  const minTravelMinutes = plan.settings?.minTravelMinutes ?? DEFAULT_MIN_TRAVEL_MINUTES;
  const jobs: Array<{ from: PlanStation; to: PlanStation; vehicle: VehicleType; key: string }> = [];
  for (const medic of plan.medics) {
    if (medic.hidden) continue;
    const stations = plannedStations(medic, sweepsForMedic(medic, windows));
    for (let i = 1; i < stations.length; i += 1) {
      const from = stations[i - 1];
      const to = stations[i];
      // A sweep's own span is the course, not a relocation — nothing to route.
      if (from.sweep?.edge === "start" && to.sweep?.edge === "end") continue;
      const vehicle = legVehicle(medic, from, to, minTravelMinutes);
      jobs.push({ from, to, vehicle, key: legKey(from, to, vehicle) });
    }
  }
  return jobs;
}

/** The window the timeline spans: first gun to last cut-off, widened to hold
 *  every posting — a medic may be in place hours before the first start. */
export function planSpan(
  courses: PlanCourse[],
  medicPlans: MedicPlan[],
): { fromMs: number; toMs: number } {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const d of courses) {
    if (!d.enabled) continue;
    const gun = new Date(d.schedule.startAt).getTime();
    if (!Number.isFinite(gun)) continue;
    from = Math.min(from, gun);
    to = Math.max(to, scheduleEndMs(d.schedule));
  }
  for (const { timeline } of medicPlans) {
    if (timeline.onDutyFromMs != null) from = Math.min(from, timeline.onDutyFromMs);
    const finite = timeline.segments.filter((s) => Number.isFinite(s.toMs));
    for (const segment of finite) to = Math.max(to, segment.toMs);
    if (timeline.standDownMs != null) to = Math.max(to, timeline.standDownMs);
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    const now = Date.now();
    return { fromMs: now - 3600_000, toMs: now + 3600_000 };
  }
  // A margin either side so the first and last marks aren't pinned to the edges.
  const pad = Math.max(15 * 60000, (to - from) * 0.04);
  return { fromMs: from - pad, toMs: to + pad };
}
