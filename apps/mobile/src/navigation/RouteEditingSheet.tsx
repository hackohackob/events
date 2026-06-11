import React, { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { buildWaypoints, useNavStore } from "./nav-store";
import { formatDistance, formatDuration } from "./geo";
import type { Waypoint } from "./types";

const BOTTOM_BAR_HEIGHT = 60;

/**
 * Banner shown over the map while waiting for the user to tap a point during
 * route editing. Rendered separately so it sits above the map, not the sheet.
 */
export function RouteEditHelperBanner() {
  const phase = useNavStore((s) => s.phase);
  const pendingInsertIndex = useNavStore((s) => s.pendingInsertIndex);
  if (phase !== "editing" || pendingInsertIndex === null) return null;
  // New point's number in the list: start is 1, vias follow, so an inserted via
  // at position p becomes list row (p + 2).
  const pointNumber = pendingInsertIndex + 2;
  return (
    <View style={styles.banner} pointerEvents="none">
      <Feather name="crosshair" size={15} color="#34d399" />
      <Text style={styles.bannerText}>Tap on map to place point {pointNumber}</Text>
    </View>
  );
}

export function RouteEditingSheet() {
  const phase = useNavStore((s) => s.phase);
  const routes = useNavStore((s) => s.routes);
  const selectedRouteId = useNavStore((s) => s.selectedRouteId);
  const loading = useNavStore((s) => s.loading);
  const pendingInsertIndex = useNavStore((s) => s.pendingInsertIndex);
  const beginInsert = useNavStore((s) => s.beginInsert);
  const cancelInsert = useNavStore((s) => s.cancelInsert);
  const removeWaypoint = useNavStore((s) => s.removeWaypoint);
  const selectRoute = useNavStore((s) => s.selectRoute);
  const origin = useNavStore((s) => s.origin);
  const destination = useNavStore((s) => s.destination);
  const vias = useNavStore((s) => s.vias);
  const waypoints = useMemo(() => buildWaypoints(origin, destination, vias), [origin, destination, vias]);

  if (phase !== "editing") return null;
  const route = routes.find((r) => r.id === selectedRouteId) ?? routes[0];

  const rows: React.ReactNode[] = [];
  waypoints.forEach((waypoint, index) => {
    rows.push(<WaypointRow key={`wp-${index}`} waypoint={waypoint} number={index + 1} onRemove={() => void removeWaypoint(index)} />);
    // Insert slot between this row and the next (none after the destination).
    if (index < waypoints.length - 1) {
      const inserting = pendingInsertIndex === index;
      rows.push(
        inserting ? (
          <View key={`new-${index}`} style={styles.placeholderRow}>
            <View style={styles.placeholderBadge}>
              <Feather name="map-pin" size={13} color="#34d399" />
            </View>
            <Text style={styles.placeholderText}>New point — tap on map</Text>
            <Pressable onPress={cancelInsert} hitSlop={8}>
              <Feather name="x" size={16} color="#94a3b8" />
            </Pressable>
          </View>
        ) : (
          <Pressable
            key={`add-${index}`}
            style={styles.addButton}
            onPress={() => {
              void Haptics.selectionAsync();
              beginInsert(index);
            }}
          >
            <Feather name="plus" size={14} color="#60a5fa" />
          </Pressable>
        ),
      );
    }
  });

  return (
    <View style={styles.sheet}>
      <View style={styles.grabber} />
      <View style={styles.header}>
        <Text style={styles.title}>ROUTE EDITING</Text>
        <Pressable
          style={styles.saveButton}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            cancelInsert();
            if (route) selectRoute(route.id);
            useNavStore.setState({ phase: "variants" });
          }}
        >
          <Text style={styles.saveText}>Save Route</Text>
        </Pressable>
      </View>

      {route ? (
        <View style={styles.summaryPill}>
          <Text style={styles.summaryDistance}>{formatDistance(route.distanceMeters)}</Text>
          <View style={styles.summaryEtaRow}>
            <Feather name="clock" size={11} color="#94a3b8" />
            <Text style={styles.summaryEta}>{formatDuration(route.durationMs)}</Text>
          </View>
          {loading ? <ActivityIndicator size="small" color="#34d399" /> : null}
        </View>
      ) : null}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {rows}
      </ScrollView>

      <Text style={styles.hint}>Tap the + button between points, then tap on the map to place the new point.</Text>
    </View>
  );
}

function WaypointRow({ waypoint, number, onRemove }: { waypoint: Waypoint; number: number; onRemove: () => void }) {
  const isStart = waypoint.kind === "start";
  const isDest = waypoint.kind === "dest";
  return (
    <View style={styles.row}>
      <View
        style={[
          styles.rowBadge,
          isStart && styles.rowBadgeStart,
          isDest && styles.rowBadgeDest,
        ]}
      >
        {isStart ? (
          <Text style={styles.rowBadgeGlyph}>▶</Text>
        ) : isDest ? (
          <Feather name="star" size={13} color="#fbbf24" />
        ) : (
          <Text style={styles.rowBadgeText}>{number - 1}</Text>
        )}
      </View>
      <Text style={styles.rowNumber}>{number}</Text>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {waypoint.label}
      </Text>
      {waypoint.kind === "via" ? (
        <Pressable onPress={onRemove} hitSlop={8} style={styles.rowAction}>
          <Feather name="trash-2" size={16} color="#64748b" />
        </Pressable>
      ) : (
        <View style={styles.rowAction} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 150,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(8,14,26,0.94)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.5)",
    paddingVertical: 9,
    paddingHorizontal: 15,
    zIndex: 70,
  },
  bannerText: { color: "#dbf5e7", fontSize: 13, fontWeight: "800" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: BOTTOM_BAR_HEIGHT,
    maxHeight: "62%",
    backgroundColor: "#0a1322",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    zIndex: 60,
  },
  grabber: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(177,199,224,0.28)",
    marginBottom: 12,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { color: "#94a3b8", fontSize: 13, fontWeight: "900", letterSpacing: 1.4 },
  saveButton: {
    backgroundColor: "rgba(52,211,153,0.16)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.5)",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  saveText: { color: "#34d399", fontSize: 13.5, fontWeight: "900" },
  summaryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    alignSelf: "flex-start",
    backgroundColor: "#111d31",
    borderRadius: 12,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  summaryDistance: { color: "#EFF6FF", fontSize: 15, fontWeight: "900" },
  summaryEtaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  summaryEta: { color: "#94a3b8", fontSize: 12, fontWeight: "700" },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#0e1a2c",
    borderRadius: 13,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  rowBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#1e293b",
    borderWidth: 2,
    borderColor: "#3B82F6",
    alignItems: "center",
    justifyContent: "center",
  },
  rowBadgeStart: { backgroundColor: "#22c55e", borderColor: "#22c55e" },
  rowBadgeDest: { backgroundColor: "#1e293b", borderColor: "#fbbf24" },
  rowBadgeGlyph: { color: "#04121f", fontSize: 11, fontWeight: "900", marginLeft: 1 },
  rowBadgeText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  rowNumber: { color: "#64748b", fontSize: 13, fontWeight: "900", width: 16 },
  rowLabel: { flex: 1, color: "#EFF6FF", fontSize: 14.5, fontWeight: "700" },
  rowAction: { width: 24, alignItems: "center" },
  addButton: {
    alignSelf: "flex-start",
    marginLeft: 13,
    marginVertical: 3,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(96,165,250,0.14)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(52,211,153,0.1)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.5)",
    borderRadius: 13,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginVertical: 3,
  },
  placeholderBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(52,211,153,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: { flex: 1, color: "#86efac", fontSize: 14, fontWeight: "800" },
  hint: { color: "#475569", fontSize: 11.5, fontWeight: "600", marginTop: 10, textAlign: "center" },
});
