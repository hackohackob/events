import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { PlanMedic } from "@events/contracts";
import { buildItinerary, formatDay, formatDuration, formatTime, DEFAULT_MIN_TRAVEL_MINUTES } from "@events/planner";
import type { ResolvedSweep } from "@events/planner";

/**
 * One medic's call sheet.
 *
 * Reads as the day actually happens: a journey, then the post it leads to, then
 * the next journey. The travel rows are their own entries rather than a note on
 * the arrival, because "leave at 11:38" is the instruction — "be at Point 2 at
 * 12:00" is only the reason for it.
 */
export function BriefingList({
  medic,
  sweeps,
  minTravelMinutes = DEFAULT_MIN_TRAVEL_MINUTES,
  nowMs,
  scroll = true,
}: {
  medic: PlanMedic;
  sweeps: ResolvedSweep[];
  minTravelMinutes?: number;
  nowMs: number;
  scroll?: boolean;
}) {
  const itinerary = useMemo(
    () => buildItinerary(medic, { minTravelMinutes, sweeps }),
    [medic, minTravelMinutes, sweeps],
  );

  const rows: React.ReactNode[] = [];
  let lastDay = "";

  itinerary.stops.forEach((stop, i) => {
    const previous = itinerary.stops[i - 1];
    const day = formatDay(stop.arriveMs);
    if (day !== lastDay) {
      lastDay = day;
      rows.push(
        <Text key={`day-${day}-${i}`} style={styles.dayHeader}>
          {day}
        </Text>,
      );
    }

    // The journey into this stop.
    if (previous?.departMs != null && stop.travelMinutes > 0) {
      const travelling = nowMs >= previous.departMs && nowMs < stop.arriveMs;
      rows.push(
        <View key={`travel-${stop.stationId}`} style={[styles.row, styles.travelRow, travelling && styles.rowNow]}>
          <Text style={styles.time}>{formatTime(previous.departMs)}</Text>
          <Feather name="corner-down-right" size={13} color="#fbbf24" style={styles.rowIcon} />
          <View style={styles.rowBody}>
            <Text style={styles.travelText} numberOfLines={2}>
              Travel to {stop.label} ({formatDuration(stop.travelMinutes)})
            </Text>
            {stop.vehicleLabel ? (
              <Text style={styles.rowMeta}>
                {stop.vehicleIcon ? `${stop.vehicleIcon} ` : ""}
                {stop.vehicleLabel}
                {stop.tight ? ` · ${stop.shortfallMinutes ?? 0} min short` : ""}
              </Text>
            ) : null}
          </View>
        </View>,
      );
    }

    const onStation =
      nowMs >= stop.arriveMs && (stop.departMs == null || nowMs < stop.departMs);
    const isSweep = stop.kind !== "post";
    rows.push(
      <View key={`stop-${stop.stationId}`} style={[styles.row, onStation && styles.rowNow]}>
        <Text style={[styles.time, styles.timeStrong]}>{formatTime(stop.arriveMs)}</Text>
        <Feather
          name={isSweep ? "wind" : "map-pin"}
          size={13}
          color={isSweep ? "#38bdf8" : "#34d399"}
          style={styles.rowIcon}
        />
        <View style={styles.rowBody}>
          <Text style={styles.stopText} numberOfLines={2}>
            {stop.kind === "sweep-start"
              ? `Sweep ${stop.label}${stop.sweepJoin === "post" ? " — from your post" : " — from the gun"}`
              : stop.kind === "sweep-end"
                ? `Sweep ends — ${stop.label}`
                : `Be on ${stop.label}`}
          </Text>
          <Text style={styles.rowMeta}>
            {stop.dwellMinutes != null
              ? `${isSweep ? "Sweeping" : "On station"} ${formatDuration(stop.dwellMinutes)}`
              : "Until stand-down"}
            {stop.note ? ` · ${stop.note}` : ""}
          </Text>
        </View>
        {onStation ? <View style={styles.nowPip} /> : null}
      </View>,
    );
  });

  if (itinerary.stops.length === 0) {
    rows.push(
      <Text key="empty" style={styles.empty}>
        Nothing planned for this medic yet.
      </Text>,
    );
  }

  if (itinerary.standDownMs != null) {
    rows.push(
      <View key="stand-down" style={[styles.row, styles.standDownRow]}>
        <Text style={styles.time}>{formatTime(itinerary.standDownMs)}</Text>
        <Feather name="log-out" size={13} color="#94a3b8" style={styles.rowIcon} />
        <View style={styles.rowBody}>
          <Text style={styles.stopText}>Stand down</Text>
        </View>
      </View>,
    );
  }

  const body = <View style={styles.list}>{rows}</View>;
  return scroll ? <ScrollView contentContainerStyle={styles.scroll}>{body}</ScrollView> : body;
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
  list: { gap: 6 },
  dayHeader: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 12,
    marginBottom: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.10)",
  },
  travelRow: { backgroundColor: "rgba(245,158,11,0.07)", borderColor: "rgba(245,158,11,0.18)" },
  standDownRow: { backgroundColor: "rgba(148,163,184,0.07)" },
  rowNow: { borderColor: "rgba(52,211,153,0.55)", backgroundColor: "rgba(16,185,129,0.10)" },
  time: { color: "#94a3b8", fontSize: 12, fontWeight: "800", width: 44, paddingTop: 1 },
  timeStrong: { color: "#e2e8f0" },
  rowIcon: { paddingTop: 2 },
  rowBody: { flex: 1, gap: 2 },
  travelText: { color: "#fcd34d", fontSize: 13, fontWeight: "700" },
  stopText: { color: "#f1f5f9", fontSize: 13, fontWeight: "800" },
  rowMeta: { color: "#64748b", fontSize: 11, fontWeight: "600" },
  nowPip: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#34d399", marginTop: 5 },
  empty: { color: "#64748b", fontSize: 13, fontWeight: "600", textAlign: "center", paddingVertical: 24 },
});
