import { useEffect, useMemo, useRef, useState } from "react";
import { usePlanStore } from "./plan-store";
import { routePlanLeg } from "./plan-api";
import {
  buildPlanCourses,
  buildSweepWindows,
  legsToRoute,
  planSpan,
  resolveMedicPlans,
  type MedicPlan,
  type PlanCourse,
} from "./plan-model";

/** How many legs may be at the router at once. The phone is on a field data
 *  connection and the answers only refine a line that is already drawn. */
const ROUTE_CONCURRENCY = 2;

/**
 * A ticking "now", for the live cursor. One minute, not one second: the only
 * things reading it are a clock to the minute and a countdown in minutes, and
 * the app's battery rules rule out a per-second render loop.
 */
export function useMinuteClock(enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

export interface PlanModel {
  courses: PlanCourse[];
  medicPlans: MedicPlan[];
  span: { fromMs: number; toMs: number };
  /** Where the timeline is pointed — the scrub position, or the wall clock. */
  cursorMs: number;
  /** True while the cursor is following the clock rather than a drag. */
  live: boolean;
}

export function usePlanModel(): PlanModel {
  const plan = usePlanStore((s) => s.plan);
  const tracks = usePlanStore((s) => s.tracks);
  const cursor = usePlanStore((s) => s.cursorMs);
  const now = useMinuteClock(cursor == null);

  // Routed leg geometry. A ref plus a tick rather than state: the answers land
  // one at a time and each would otherwise rebuild the whole map's data.
  const paths = useRef(new Map<string, [number, number][]>());
  const attempted = useRef(new Set<string>());
  const [pathTick, setPathTick] = useState(0);

  const courses = useMemo(() => buildPlanCourses(plan, tracks), [plan, tracks]);
  const windows = useMemo(() => buildSweepWindows(courses), [courses]);

  const medicPlans = useMemo(
    () => resolveMedicPlans(plan, windows, paths.current),
    // pathTick is the point: the map of routed legs is mutated in place.
    [plan, windows, pathTick],
  );

  const span = useMemo(() => planSpan(courses, medicPlans), [courses, medicPlans]);

  // ── Routing pass ────────────────────────────────────────────────────────
  useEffect(() => {
    const jobs = legsToRoute(plan, windows).filter((job) => !attempted.current.has(job.key));
    if (jobs.length === 0) return;
    let cancelled = false;
    let landed = 0;

    const worker = async () => {
      for (;;) {
        // `cancelled` only stops NEW requests. An answer that is already on its
        // way is still cached: dropping it would orphan the work permanently,
        // because the leg is marked attempted and will never be asked again.
        if (cancelled) return;
        const job = jobs.shift();
        if (!job) return;
        attempted.current.add(job.key);
        const geometry = await routePlanLeg(
          { lat: job.from.lat, lng: job.from.lng },
          { lat: job.to.lat, lng: job.to.lng },
          job.vehicle,
          job.to.via ?? [],
        );
        if (geometry) {
          paths.current.set(job.key, geometry);
          landed += 1;
          setPathTick((t) => t + 1);
        }
      }
    };

    void Promise.all(Array.from({ length: ROUTE_CONCURRENCY }, worker)).then(() => {
      // One last nudge so a batch whose answers all landed while the effect was
      // being torn down still reaches the map.
      if (landed > 0) setPathTick((t) => t + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [plan, windows]);

  const cursorMs = cursor ?? now;
  return { courses, medicPlans, span, cursorMs, live: cursor == null };
}
