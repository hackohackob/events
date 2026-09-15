import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { fieldAt, formatDay, formatDuration, formatTime, scheduleEndMs } from "@events/planner";
import type { PlanCourse } from "./plan-model";

/**
 * Course timing, read-only.
 *
 * The start, the winner's time and the cut-off are the three numbers the whole
 * plan is built on, so the field needs to be able to check them — but they are
 * a decision made once, at the desk, with the race director in the room. This
 * page shows them and what they imply right now; it does not let a phone in a
 * valley redefine when the race ends.
 */
export function CoursesPage({
  courses,
  nowMs,
  bottomInset,
}: {
  courses: PlanCourse[];
  nowMs: number;
  bottomInset: number;
}) {
  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: bottomInset + 24 }}>
      {courses.map((course) => {
        const startMs = new Date(course.schedule.startAt).getTime();
        const endMs = scheduleEndMs(course.schedule);
        const field = course.hasCourse ? fieldAt(course.schedule, course.shape, course.course, nowMs) : null;
        return (
          <View key={course.id} style={[styles.card, !course.enabled && styles.cardOff]}>
            <View style={styles.cardHeader}>
              <View style={[styles.swatch, { backgroundColor: course.color }]} />
              <Text style={styles.title} numberOfLines={1}>
                {course.label}
              </Text>
              {!course.enabled ? <Text style={styles.offTag}>OFF</Text> : null}
            </View>

            <View style={styles.grid}>
              <Stat label="Start" value={Number.isFinite(startMs) ? formatTime(startMs) : "—"} sub={Number.isFinite(startMs) ? formatDay(startMs) : undefined} />
              <Stat label="Winner" value={formatDuration(course.schedule.fastestMinutes)} />
              <Stat label="Cut-off" value={formatDuration(course.schedule.slowestMinutes)} sub={Number.isFinite(endMs) ? `ends ${formatTime(endMs)}` : undefined} />
            </View>

            {field ? (
              <View style={styles.liveRow}>
                <Feather name="users" size={12} color="#38bdf8" />
                <Text style={styles.liveText}>
                  {field.onCourse} on course · {field.finished} finished · {field.notStarted} to start
                </Text>
              </View>
            ) : (
              <Text style={styles.noCourse}>No track loaded for this discipline.</Text>
            )}
          </View>
        );
      })}
      {courses.length === 0 ? <Text style={styles.noCourse}>This event has no courses in the plan.</Text> : null}
    </ScrollView>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 12 },
  card: {
    marginTop: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
    gap: 10,
  },
  cardOff: { opacity: 0.5 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  swatch: { width: 12, height: 12, borderRadius: 4 },
  title: { color: "#f1f5f9", fontSize: 15, fontWeight: "900", flex: 1 },
  offTag: { color: "#64748b", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  grid: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 11, padding: 9, gap: 1 },
  statLabel: { color: "#64748b", fontSize: 9, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  statValue: { color: "#e2e8f0", fontSize: 15, fontWeight: "900" },
  statSub: { color: "#64748b", fontSize: 10, fontWeight: "700" },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveText: { color: "#94a3b8", fontSize: 11, fontWeight: "700" },
  noCourse: { color: "#64748b", fontSize: 12, fontWeight: "700", paddingVertical: 6 },
});
