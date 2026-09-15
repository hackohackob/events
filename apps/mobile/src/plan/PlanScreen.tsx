import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PlanStation } from "@events/contracts";
import { formatDuration, formatTime, DEFAULT_MIN_TRAVEL_MINUTES } from "@events/planner";
import { useSessionStore } from "../security/session-store";
import { usePlanStore, myPlanMedic, type PlanPage } from "./plan-store";
import { usePlanModel } from "./usePlanModel";
import { PlanMap } from "./PlanMap";
import { PlanTimeline } from "./PlanTimeline";
import { BriefingList } from "./BriefingList";
import { CoursesPage } from "./CoursesPage";

/** `team` is the whole roster's call sheets — a coordinator's view of the board,
 *  so it is only offered to one. Everyone else gets their own plan. */
const PAGES: Array<{ key: PlanPage; label: string; icon: keyof typeof Feather.glyphMap; coordinatorOnly?: boolean }> = [
  { key: "timeline", label: "Timeline", icon: "activity" },
  { key: "my-plan", label: "My plan", icon: "user" },
  { key: "team", label: "Team", icon: "users", coordinatorOnly: true },
  { key: "courses", label: "Courses", icon: "flag" },
];

/** How far one nudge moves a posting. Fifteen minutes is the unit a race is
 *  actually planned in; the long press on the same control jumps an hour. */
const NUDGE_MINUTES = 15;

/**
 * The planner, as a page over the map.
 *
 * Split in two on purpose: everything expensive — resolving every medic's
 * timeline, and the background pass that asks the router for the real shape of
 * each journey — lives in the body, which only exists while the screen is
 * actually open. Mounted permanently on the map screen, a single hook in the
 * wrong half would keep that work running all day behind a closed modal.
 */
export function PlanScreen() {
  const open = usePlanStore((s) => s.open);
  const close = usePlanStore((s) => s.closePlanner);
  if (!open) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={close} statusBarTranslucent>
      <PlanScreenBody />
    </Modal>
  );
}

function PlanScreenBody() {
  const insets = useSafeAreaInsets();
  const page = usePlanStore((s) => s.page);
  const setPage = usePlanStore((s) => s.setPage);
  const close = usePlanStore((s) => s.closePlanner);
  const loading = usePlanStore((s) => s.loading);
  const error = usePlanStore((s) => s.error);
  const plan = usePlanStore((s) => s.plan);
  const saveState = usePlanStore((s) => s.saveState);
  const editing = usePlanStore((s) => s.editing);
  const setEditing = usePlanStore((s) => s.setEditing);
  const selectedMedicId = usePlanStore((s) => s.selectedMedicId);
  const selectMedic = usePlanStore((s) => s.selectMedic);
  const mutate = usePlanStore((s) => s.mutate);
  const userId = useSessionStore((s) => s.userId);
  const role = useSessionStore((s) => s.role);
  const isCoordinator = role === "coordinator";

  const model = usePlanModel();
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  /** Measured, not guessed: the transport's height changes with the lane count
   *  and whether it is expanded, and the edit strip has to sit clear of it. */
  const [timelineHeight, setTimelineHeight] = useState(180);

  const minTravelMinutes = plan?.settings?.minTravelMinutes ?? DEFAULT_MIN_TRAVEL_MINUTES;
  const mine = myPlanMedic(plan, userId);
  const selected = model.medicPlans.find((m) => m.medic.id === selectedMedicId) ?? null;

  // ── Editing ─────────────────────────────────────────────────────────────
  const patchMedic = useCallback(
    (planMedicId: string, patch: (stations: PlanStation[]) => PlanStation[]) => {
      mutate((current) => ({
        ...current,
        medics: current.medics.map((m) =>
          m.id === planMedicId
            ? {
                ...m,
                stations: patch(m.stations)
                  .slice()
                  .sort((a, b) => new Date(a.arriveAt).getTime() - new Date(b.arriveAt).getTime()),
              }
            : m,
        ),
      }));
    },
    [mutate],
  );

  const onMapPress = useCallback(
    (lngLat: [number, number]) => {
      if (!editing || !selected) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (selectedStationId) {
        // A posting is picked: this tap is where it moves to. The cached travel
        // time is dropped with it — it was measured for the old position, and a
        // stale duration is worse than an honest estimate.
        patchMedic(selected.medic.id, (stations) =>
          stations.map((s) =>
            s.id === selectedStationId
              ? { ...s, lat: lngLat[1], lng: lngLat[0], via: undefined, travelMinutes: undefined, travelSource: undefined, travelVehicle: undefined }
              : s,
          ),
        );
        return;
      }
      // Nothing picked: the tap adds a posting, timed at wherever the timeline
      // is pointed — which is the whole reason the cursor sits under the map.
      const id = `st-${Date.now().toString(36)}`;
      const count = selected.medic.stations.length + 1;
      patchMedic(selected.medic.id, (stations) => [
        ...stations,
        {
          id,
          arriveAt: new Date(model.cursorMs).toISOString(),
          lat: lngLat[1],
          lng: lngLat[0],
          label: `Position ${count}`,
        },
      ]);
      setSelectedStationId(id);
    },
    [editing, selected, selectedStationId, patchMedic, model.cursorMs],
  );

  const nudgeStation = useCallback(
    (minutes: number) => {
      if (!selected || !selectedStationId) return;
      void Haptics.selectionAsync();
      patchMedic(selected.medic.id, (stations) =>
        stations.map((s) =>
          s.id === selectedStationId
            ? { ...s, arriveAt: new Date(new Date(s.arriveAt).getTime() + minutes * 60000).toISOString() }
            : s,
        ),
      );
    },
    [selected, selectedStationId, patchMedic],
  );

  const deleteStation = useCallback(() => {
    if (!selected || !selectedStationId) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    patchMedic(selected.medic.id, (stations) => stations.filter((s) => s.id !== selectedStationId));
    setSelectedStationId(null);
  }, [selected, selectedStationId, patchMedic]);

  const editorStation = useMemo(
    () => selected?.medic.stations.find((s) => s.id === selectedStationId) ?? null,
    [selected, selectedStationId],
  );

  const enterEdit = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Editing is always about one medic. Falling back to the signed-in medic's
    // own row means the common case — fixing your own plan — needs no picking.
    if (!selectedMedicId) selectMedic(mine?.id ?? model.medicPlans[0]?.medic.id ?? null);
    setEditing(true);
  };

  const leaveEdit = () => {
    setEditing(false);
    setSelectedStationId(null);
    void usePlanStore.getState().saveNow();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable style={styles.headerBtn} onPress={close} hitSlop={8}>
            <Feather name="chevron-left" size={22} color="#e2e8f0" />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Deployment plan</Text>
            <Text style={styles.headerSub}>
              {saveState === "saving"
                ? "Saving…"
                : saveState === "dirty"
                  ? "Unsaved changes"
                  : saveState === "error"
                    ? "Save failed — will retry on the next edit"
                    : `${model.medicPlans.length} medic${model.medicPlans.length === 1 ? "" : "s"}`}
            </Text>
          </View>
          {page === "timeline" ? (
            <Pressable
              style={[styles.headerBtn, editing && styles.headerBtnActive]}
              onPress={editing ? leaveEdit : enterEdit}
              hitSlop={8}
            >
              <Feather name={editing ? "check" : "edit-2"} size={18} color={editing ? "#04121f" : "#e2e8f0"} />
            </Pressable>
          ) : (
            <View style={styles.headerBtn} />
          )}
        </View>

        {/* Pages */}
        <View style={styles.tabs}>
          {PAGES.filter((tab) => !tab.coordinatorOnly || isCoordinator).map((tab) => {
            const active = page === tab.key;
            return (
              <Pressable
                key={tab.key}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => {
                  setPage(tab.key);
                  if (tab.key !== "timeline") setEditing(false);
                }}
              >
                <Feather name={tab.icon} size={13} color={active ? "#04121f" : "#94a3b8"} />
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {loading && !plan ? (
          <View style={styles.center}>
            <ActivityIndicator color="#38bdf8" />
          </View>
        ) : error && !plan ? (
          <View style={styles.center}>
            <Feather name="alert-circle" size={26} color="#f87171" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : page === "timeline" ? (
          <View style={styles.mapWrap}>
            <PlanMap
              courses={model.courses}
              medicPlans={model.medicPlans}
              cursorMs={model.cursorMs}
              selectedMedicId={selectedMedicId}
              editing={editing}
              onSelectMedic={(id) => selectMedic(id)}
              onMapPress={onMapPress}
            />

            {/* Simplified edit strip: pick a posting, move it, retime it, drop it. */}
            {editing && selected ? (
              <View style={[styles.editBar, { bottom: insets.bottom + 18 + timelineHeight }]}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  {selected.medic.stations.map((station, i) => {
                    const picked = station.id === selectedStationId;
                    return (
                      <Pressable
                        key={station.id}
                        style={[styles.chip, picked && styles.chipPicked]}
                        onPress={() => setSelectedStationId(picked ? null : station.id)}
                      >
                        <Text style={[styles.chipText, picked && styles.chipTextPicked]} numberOfLines={1}>
                          {i + 1}. {station.label} · {formatTime(new Date(station.arriveAt).getTime())}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {editorStation ? (
                  <View style={styles.editActions}>
                    <Pressable style={styles.editBtn} onPress={() => nudgeStation(-NUDGE_MINUTES)}>
                      <Text style={styles.editBtnText}>−{NUDGE_MINUTES}m</Text>
                    </Pressable>
                    <Pressable style={styles.editBtn} onPress={() => nudgeStation(NUDGE_MINUTES)}>
                      <Text style={styles.editBtnText}>+{NUDGE_MINUTES}m</Text>
                    </Pressable>
                    <Text style={styles.editHint} numberOfLines={1}>
                      Tap the map to move it
                    </Text>
                    <Pressable style={[styles.editBtn, styles.editBtnDanger]} onPress={deleteStation}>
                      <Feather name="trash-2" size={14} color="#fca5a5" />
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.editHint} numberOfLines={1}>
                    Tap the map to add a posting at {formatTime(model.cursorMs)} — or pick one above.
                  </Text>
                )}
              </View>
            ) : null}

            <PlanTimeline
              courses={model.courses}
              medicPlans={model.medicPlans}
              span={model.span}
              cursorMs={model.cursorMs}
              live={model.live}
              bottomInset={insets.bottom}
              onHeightChange={setTimelineHeight}
            />
          </View>
        ) : page === "my-plan" ? (
          <View style={styles.page}>
            {mine ? (
              <BriefingList
                medic={mine}
                sweeps={model.medicPlans.find((m) => m.medic.id === mine.id)?.sweeps ?? []}
                minTravelMinutes={minTravelMinutes}
                nowMs={model.cursorMs}
              />
            ) : (
              <View style={styles.center}>
                <Feather name="user-x" size={26} color="#475569" />
                <Text style={styles.errorText}>You are not on this deployment plan.</Text>
              </View>
            )}
          </View>
        ) : page === "team" && isCoordinator ? (
          <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
            {model.medicPlans.map(({ medic, timeline, sweeps }) => (
              <View key={medic.id} style={styles.teamBlock}>
                <View style={styles.teamHeader}>
                  <View style={[styles.teamDot, { backgroundColor: medic.color }]} />
                  <Text style={styles.teamName} numberOfLines={1}>
                    {medic.name}
                  </Text>
                  {medic.unit ? <Text style={styles.teamUnit}>{medic.unit}</Text> : null}
                  <View style={{ flex: 1 }} />
                  <Text style={styles.teamMeta}>
                    {timeline.moveCount} move{timeline.moveCount === 1 ? "" : "s"} ·{" "}
                    {formatDuration(timeline.travelMinutes)}
                  </Text>
                </View>
                <BriefingList
                  medic={medic}
                  sweeps={sweeps}
                  minTravelMinutes={minTravelMinutes}
                  nowMs={model.cursorMs}
                  scroll={false}
                />
              </View>
            ))}
            {model.medicPlans.length === 0 ? (
              <Text style={styles.errorText}>Nobody is on this plan yet.</Text>
            ) : null}
          </ScrollView>
        ) : (
          <CoursesPage courses={model.courses} nowMs={model.cursorMs} bottomInset={insets.bottom} />
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#060d18" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 8, gap: 8 },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  headerBtnActive: { backgroundColor: "#34d399" },
  headerTitleWrap: { flex: 1 },
  headerTitle: { color: "#f8fafc", fontSize: 16, fontWeight: "900", letterSpacing: 0.2 },
  headerSub: { color: "#64748b", fontSize: 11, fontWeight: "700" },
  tabs: { flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingBottom: 8 },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  tabActive: { backgroundColor: "#e2e8f0" },
  tabText: { color: "#94a3b8", fontSize: 11, fontWeight: "800" },
  tabTextActive: { color: "#04121f" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  errorText: { color: "#94a3b8", fontSize: 13, fontWeight: "700", textAlign: "center" },
  mapWrap: { flex: 1 },
  page: { flex: 1, paddingHorizontal: 12 },
  teamBlock: { marginTop: 14 },
  teamHeader: { flexDirection: "row", alignItems: "center", gap: 7, paddingBottom: 6 },
  teamDot: { width: 10, height: 10, borderRadius: 5 },
  teamName: { color: "#f1f5f9", fontSize: 14, fontWeight: "900" },
  teamUnit: { color: "#64748b", fontSize: 11, fontWeight: "700" },
  teamMeta: { color: "#64748b", fontSize: 10, fontWeight: "700" },
  editBar: {
    position: "absolute",
    left: 10,
    right: 10,
    backgroundColor: "rgba(31, 22, 6, 0.96)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    padding: 8,
    gap: 7,
    zIndex: 45,
  },
  chipRow: { gap: 6, paddingRight: 4 },
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.06)",
    maxWidth: 190,
  },
  chipPicked: { backgroundColor: "#fbbf24" },
  chipText: { color: "#cbd5e1", fontSize: 11, fontWeight: "800" },
  chipTextPicked: { color: "#2a1a02" },
  editActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  editBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  editBtnDanger: { backgroundColor: "rgba(239,68,68,0.16)" },
  editBtnText: { color: "#fcd34d", fontSize: 12, fontWeight: "900" },
  editHint: { color: "#a8a29e", fontSize: 11, fontWeight: "700", flex: 1 },
});
