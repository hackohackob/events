import React, { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { buildItinerary, formatTime, DEFAULT_MIN_TRAVEL_MINUTES } from "@events/planner";
import { useSessionStore } from "../security/session-store";
import { usePlanStore, myPlanMedic } from "./plan-store";
import { buildPlanCourses, buildSweepWindows, sweepsForMedic } from "./plan-model";
import { useMinuteClock } from "./usePlanModel";

/**
 * The plan button, under the status control on the map.
 *
 * Only appears when the desk has actually put this medic (or, for a
 * coordinator, anyone) on a deployment plan — an event planned on paper should
 * leave the map exactly as it was. The badge is the thing that earns the space:
 * it is the next move and how long until it, so the common question is answered
 * without opening anything.
 */
export function PlanControl() {
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
  const hasSomethingToShow = mine != null || (isCoordinator && (plan?.medics.length ?? 0) > 0);
  if (!hasSomethingToShow) return null;

  const urgent = next != null && next.minutes <= 15;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        style={[styles.button, urgent && styles.buttonUrgent]}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          // A medic wants their own call sheet; a coordinator wants the board.
          openPlanner(mine ? "my-plan" : "timeline");
        }}
      >
        <Feather name="clipboard" size={19} color={urgent ? "#fbbf24" : "#93c5fd"} />
      </Pressable>

      {next ? (
        <Pressable
          style={[styles.badge, urgent && styles.badgeUrgent]}
          onPress={() => openPlanner(mine ? "my-plan" : "timeline")}
        >
          <Text style={[styles.badgeTime, urgent && styles.badgeTimeUrgent]} numberOfLines={1}>
            {next.minutes >= 60 ? formatTime(next.departMs) : `${next.minutes}m`}
          </Text>
          <Text style={styles.badgeLabel} numberOfLines={1}>
            {next.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Sits directly under the status control (left: 12, top: 70, 46 high).
  wrap: { position: "absolute", left: 12, top: 124, zIndex: 29, alignItems: "flex-start" },
  button: {
    width: 46,
    height: 46,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: "rgba(147,197,253,0.5)",
    backgroundColor: "rgba(6, 16, 30, 0.95)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  buttonUrgent: { borderColor: "rgba(251,191,36,0.75)", backgroundColor: "rgba(31,22,6,0.95)" },
  badge: {
    marginTop: 5,
    maxWidth: 132,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 4,
    backgroundColor: "rgba(6, 16, 30, 0.95)",
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.25)",
  },
  badgeUrgent: { borderColor: "rgba(251,191,36,0.45)", backgroundColor: "rgba(31,22,6,0.95)" },
  badgeTime: { color: "#93c5fd", fontSize: 12, fontWeight: "900", letterSpacing: 0.3 },
  badgeTimeUrgent: { color: "#fbbf24" },
  badgeLabel: { color: "#64748b", fontSize: 9, fontWeight: "800" },
});
