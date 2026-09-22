import { useCallback, useEffect, useMemo } from "react";
import { buildItinerary, DEFAULT_MIN_TRAVEL_MINUTES } from "@events/planner";
import { useSessionStore } from "../security/session-store";
import { usePlanStore, myPlanMedic } from "./plan-store";
import { buildPlanCourses, buildSweepWindows, sweepsForMedic } from "./plan-model";
import { useMinuteClock } from "./usePlanModel";

/**
 * The plan entry in the map's Menu.
 *
 * Only `visible` when the desk has actually put this medic (or, for a
 * coordinator, anyone) on a deployment plan — an event planned on paper should
 * leave the menu exactly as it was. `urgent` tints the row when the next move
 * is 15 minutes away or less.
 */
export function usePlanEntry() {
  const role = useSessionStore((s) => s.role);
  const userId = useSessionStore((s) => s.userId);
  const token = useSessionStore((s) => s.token);
  const plan = usePlanStore((s) => s.plan);
  const tracks = usePlanStore((s) => s.tracks);
  const forbidden = usePlanStore((s) => s.forbidden);
  const load = usePlanStore((s) => s.load);
  const openPlanner = usePlanStore((s) => s.openPlanner);

  const isCoordinator = role === "coordinator";

  useEffect(() => {
    if (!token || forbidden) return;
    void load();
  }, [token, forbidden, load]);

  const mine = myPlanMedic(plan, userId);
  // The clock only ticks when there is a countdown to keep honest — the map
  // screen must not carry a timer for a button that isn't on it.
  const now = useMinuteClock(mine != null);

  /**
   * This medic's call sheet. Rebuilt only when the plan itself changes: reading
   * the courses means walking every GPX, which is not something to redo once a
   * minute just because the clock moved.
   */
  const itinerary = useMemo(() => {
    if (!mine) return null;
    const windows = buildSweepWindows(buildPlanCourses(plan, tracks));
    return buildItinerary(mine, {
      minTravelMinutes: plan?.settings?.minTravelMinutes ?? DEFAULT_MIN_TRAVEL_MINUTES,
      sweeps: sweepsForMedic(mine, windows),
    });
  }, [mine, plan, tracks]);

  /** The next thing this medic has to do, and when. */
  const next = useMemo(() => {
    if (!itinerary) return null;
    for (let i = 0; i < itinerary.stops.length; i += 1) {
      const stop = itinerary.stops[i];
      const previous = itinerary.stops[i - 1];
      const departMs = previous?.departMs ?? stop.arriveMs;
      if (departMs <= now) continue;
      return { label: stop.label, departMs, minutes: Math.round((departMs - now) / 60000) };
    }
    return null;
  }, [itinerary, now]);

  // Nothing planned for this user, and not a coordinator with a plan to read.
  const visible = mine != null || (isCoordinator && (plan?.medics.length ?? 0) > 0);
  const urgent = next != null && next.minutes <= 15;
  // A medic wants their own call sheet; a coordinator wants the board.
  const open = useCallback(() => openPlanner(mine ? "my-plan" : "timeline"), [openPlanner, mine]);

  return { visible, next, urgent, open };
}
