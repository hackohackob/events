import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { closestMedicColor, VEHICLE_TYPE_META, type ClosestMedic, type MedicStatus } from "@events/contracts";
import { freshnessBucket, freshnessLabel } from "../map/freshness";

/** Status glyph + tone, matched to the medic sheet so a medic reads the same everywhere. */
const STATUS_META: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  available: { label: "Available", color: "#34d399", icon: "check-circle" },
  stationary: { label: "Holding post", color: "#34d399", icon: "anchor" },
  sweeper: { label: "Sweeper", color: "#38bdf8", icon: "wind" },
  going_to: { label: "Already en route", color: "#fbbf24", icon: "navigation" },
  rest: { label: "Resting", color: "#a78bfa", icon: "moon" },
};

function statusMeta(status: MedicStatus) {
  return STATUS_META[status] ?? STATUS_META.available;
}

/** "7 min" — the number that decides the dispatch, so it is never abbreviated away. */
function minutes(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins}`;
  const hours = Math.floor(mins / 60);
  return `${hours}h${String(mins % 60).padStart(2, "0")}`;
}

function minutesUnit(ms: number): string {
  return ms < 3_600_000 ? "min" : "";
}

function distance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

interface Props {
  medics: ClosestMedic[];
  unlocatedCount: number;
  loading: boolean;
  /** Medic currently being assigned — shows a spinner on that row. */
  assigningId: string | null;
  /** The row whose route is emphasised on the map. */
  selectedId: string | null;
  onBack: () => void;
  onClose: () => void;
  onSelect: (medic: ClosestMedic) => void;
  onAssign: (medic: ClosestMedic) => void;
}

/**
 * The "closest medic" half-drawer: the five fastest responders to this
 * incident, each on their own vehicle's routing profile, colour-matched to the
 * lines drawn on the map above.
 *
 * Deliberately kept at one snap point by the parent sheet — this is a decision
 * list read against the map, so it must never grow and cover the routes it is
 * describing.
 */
export function ClosestMedicsPanel({
  medics,
  unlocatedCount,
  loading,
  assigningId,
  selectedId,
  onBack,
  onClose,
  onSelect,
  onAssign,
}: Props) {
  const fastest = medics[0]?.durationMs;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onBack} hitSlop={8}>
          <Feather name="arrow-left" size={19} color="#cbd5e1" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Closest medic</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {loading
              ? "Routing every medic…"
              : medics.length === 0
                ? "Nobody could be routed"
                : `${medics.length} fastest by travel time` +
                  (unlocatedCount > 0 ? ` · ${unlocatedCount} without a fix` : "")}
          </Text>
        </View>
        <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
          <Feather name="x" size={18} color="#94a3b8" />
        </Pressable>
      </View>

      <BottomSheetScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {loading && medics.length === 0 ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#34d399" />
            <Text style={styles.loadingText}>Working out who gets there first…</Text>
          </View>
        ) : null}

        {medics.map((medic) => {
          const accent = closestMedicColor(medic.rank);
          const status = statusMeta(medic.status);
          const vehicle = VEHICLE_TYPE_META[medic.vehicleType];
          const selected = selectedId === medic.medicId;
          const resting = medic.status === "rest";
          const ageMs = medic.lastSeenAt ? Date.now() - new Date(medic.lastSeenAt).getTime() : undefined;
          const staleFix = ageMs !== undefined && freshnessBucket(ageMs) !== "fresh";
          // "+4 min" against the leader makes the trade-off explicit when the
          // fastest medic is the one you'd rather not pull off a post.
          const behindMs = fastest != null ? medic.durationMs - fastest : 0;

          return (
            <Pressable
              key={medic.medicId}
              style={[
                styles.card,
                { borderColor: selected ? `${accent}aa` : `${accent}33`, backgroundColor: `${accent}0e` },
                selected && styles.cardSelected,
              ]}
              onPress={() => {
                void Haptics.selectionAsync();
                onSelect(medic);
              }}
            >
              {/* Rank stripe — the same colour as this medic's line on the map. */}
              <View style={[styles.rankStripe, { backgroundColor: accent }]} />

              <View style={styles.cardMain}>
                <View style={styles.nameRow}>
                  <Feather name={status.icon} size={13} color={status.color} />
                  <Text style={styles.name} numberOfLines={1}>{medic.name}</Text>
                  {medic.assigned ? (
                    <View style={styles.onItChip}>
                      <Text style={styles.onItChipText} allowFontScaling={false}>ON IT</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.vehicleGlyph} allowFontScaling={false}>{vehicle.icon}</Text>
                  <Text style={styles.metaText} numberOfLines={1}>
                    {vehicle.label} · {status.label}
                  </Text>
                </View>

                {/* Anything that makes this medic a worse choice than their ETA
                    suggests gets said out loud, not hidden behind a colour. */}
                {resting ? (
                  <View style={styles.warnRow}>
                    <Feather name="moon" size={10.5} color="#c4b5fd" />
                    <Text style={styles.warnText}>On rest — dispatching wakes them</Text>
                  </View>
                ) : null}
                {medic.direct ? (
                  <View style={styles.warnRow}>
                    <Feather name="alert-triangle" size={10.5} color="#fbbf24" />
                    <Text style={[styles.warnText, { color: "#fcd34d" }]}>
                      No route found — straight-line estimate
                    </Text>
                  </View>
                ) : null}
                {staleFix ? (
                  <View style={styles.warnRow}>
                    <Feather name="wifi-off" size={10.5} color="#94a3b8" />
                    <Text style={styles.warnText}>Position {freshnessLabel(ageMs!)}</Text>
                  </View>
                ) : null}
              </View>

              {/* Time to incident is the decision — it gets the size. */}
              <View style={styles.etaBlock}>
                <View style={styles.etaValueRow}>
                  <Text style={[styles.etaValue, { color: accent }]} allowFontScaling={false}>
                    {minutes(medic.durationMs)}
                  </Text>
                  <Text style={[styles.etaUnit, { color: accent }]} allowFontScaling={false}>
                    {minutesUnit(medic.durationMs)}
                  </Text>
                </View>
                <Text style={styles.etaDistance} allowFontScaling={false}>
                  {distance(medic.distanceMeters)}
                </Text>
                {behindMs >= 60_000 ? (
                  <Text style={styles.etaBehind} allowFontScaling={false}>
                    +{minutes(behindMs)} min
                  </Text>
                ) : null}
              </View>

              <Pressable
                style={[
                  styles.assignBtn,
                  { backgroundColor: accent },
                  medic.assigned && styles.assignBtnDone,
                ]}
                hitSlop={6}
                disabled={medic.assigned || assigningId != null}
                onPress={() => onAssign(medic)}
              >
                {assigningId === medic.medicId ? (
                  <ActivityIndicator size="small" color="#04121f" />
                ) : (
                  <Text style={styles.assignBtnText} allowFontScaling={false}>
                    {medic.assigned ? "✓" : "Assign"}
                  </Text>
                )}
              </Pressable>
            </Pressable>
          );
        })}

        {!loading && medics.length === 0 ? (
          <Text style={styles.emptyText}>
            No medic could be routed to this incident. Everyone may be out of range, or
            nobody has reported a position yet.
          </Text>
        ) : null}

        {medics.length > 0 ? (
          <Text style={styles.footnote}>
            Times are routed on each medic's own vehicle, so the closest dot is not always
            the fastest answer. Tap a card to highlight its route on the map.
          </Text>
        ) : null}
      </BottomSheetScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(148,163,184,0.18)",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: "#EFF6FF", fontSize: 17, fontWeight: "900", letterSpacing: 0.2 },
  subtitle: { color: "#64748b", fontSize: 11.5, fontWeight: "600", marginTop: 1 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },

  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 120, gap: 9 },

  loadingBox: { alignItems: "center", gap: 9, paddingVertical: 26 },
  loadingText: { color: "#7e93ac", fontSize: 12.5, fontWeight: "700" },

  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 10,
    paddingRight: 11,
    paddingLeft: 0,
    overflow: "hidden",
  },
  cardSelected: { borderWidth: 1.5 },
  // The stripe is the whole rank indicator — no number badge competing with the
  // ETA for attention, and it matches the medic's line on the map exactly.
  rankStripe: { width: 5, alignSelf: "stretch", marginRight: 2 },

  cardMain: { flex: 1, minWidth: 0, gap: 2, paddingLeft: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { color: "#E9F1FA", fontSize: 14.5, fontWeight: "800", flexShrink: 1 },
  onItChip: {
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 5,
    backgroundColor: "rgba(251,191,36,0.2)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.45)",
  },
  onItChipText: { color: "#fcd34d", fontSize: 8, fontWeight: "900", letterSpacing: 0.5 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  vehicleGlyph: { fontSize: 12, lineHeight: 15, includeFontPadding: false },
  metaText: { color: "#8da3bd", fontSize: 11.5, fontWeight: "700", flexShrink: 1 },
  warnRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 1 },
  warnText: { color: "#c4b5fd", fontSize: 10.5, fontWeight: "700", flexShrink: 1 },

  etaBlock: { alignItems: "flex-end", minWidth: 58 },
  etaValueRow: { flexDirection: "row", alignItems: "baseline", gap: 2 },
  etaValue: { fontSize: 26, fontWeight: "900", letterSpacing: -0.5, includeFontPadding: false },
  etaUnit: { fontSize: 11, fontWeight: "900", opacity: 0.85 },
  etaDistance: { color: "#7e93ac", fontSize: 11, fontWeight: "700", marginTop: 1 },
  etaBehind: { color: "#5b6b80", fontSize: 9.5, fontWeight: "800" },

  assignBtn: {
    minWidth: 58,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  assignBtnDone: { opacity: 0.45 },
  assignBtnText: { color: "#04121f", fontSize: 12.5, fontWeight: "900" },

  emptyText: {
    color: "#64748b",
    fontSize: 12.5,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 14,
    paddingVertical: 20,
  },
  footnote: {
    color: "#475569",
    fontSize: 10.5,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 15,
    marginTop: 4,
    paddingHorizontal: 8,
  },
});
