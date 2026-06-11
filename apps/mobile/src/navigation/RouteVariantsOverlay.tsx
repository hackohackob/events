import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavStore } from "./nav-store";
import { formatDistance, formatDuration } from "./geo";
import { CompactTransportRow } from "./CompactTransportRow";
import { SURFACE_COLORS, SURFACE_LABELS, SURFACE_LEGEND } from "./surface";

const BOTTOM_BAR_HEIGHT = 60;

/** Floating route chips (A/B/C), surface legend, and the start/edit action bar. */
export function RouteVariantsOverlay() {
  const phase = useNavStore((s) => s.phase);
  const routes = useNavStore((s) => s.routes);
  const selectedRouteId = useNavStore((s) => s.selectedRouteId);
  const selectRoute = useNavStore((s) => s.selectRoute);
  const startEditing = useNavStore((s) => s.startEditing);
  const startNavigation = useNavStore((s) => s.startNavigation);
  const cancel = useNavStore((s) => s.cancel);
  const loading = useNavStore((s) => s.loading);
  const error = useNavStore((s) => s.error);

  if (phase !== "variants") return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <SurfaceLegend />

      {/* Route chips on the right. */}
      <View style={styles.chipColumn} pointerEvents="box-none">
        {routes.map((route) => {
          const selected = route.id === (selectedRouteId ?? routes[0]?.id);
          return (
            <Pressable
              key={route.id}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => {
                void Haptics.selectionAsync();
                selectRoute(route.id);
              }}
            >
              <View style={[styles.chipBadge, selected && styles.chipBadgeSelected]}>
                <Text style={[styles.chipBadgeText, selected && styles.chipBadgeTextSelected]}>{route.id}</Text>
              </View>
              <View>
                <Text style={styles.chipDistance}>{formatDistance(route.distanceMeters)}</Text>
                <View style={styles.chipEtaRow}>
                  <Feather name="clock" size={10} color="#94a3b8" />
                  <Text style={styles.chipEta}>{formatDuration(route.durationMs)}</Text>
                </View>
              </View>
            </Pressable>
          );
        })}
        {loading && routes.length === 0 ? (
          <View style={styles.chip}>
            <ActivityIndicator size="small" color="#34d399" />
            <Text style={styles.chipEta}>Routing…</Text>
          </View>
        ) : null}
      </View>

      {/* Bottom action bar. */}
      <View style={styles.actionBar}>
        {/* Transport stays changeable here — switching re-routes for the new mode. */}
        <CompactTransportRow style={styles.transportRow} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actionRow}>
          <Pressable style={styles.secondaryButton} onPress={cancel}>
            <Feather name="x" size={18} color="#cbd5e1" />
            <Text style={styles.secondaryText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={startEditing}
            disabled={routes.length === 0}
          >
            <Feather name="edit-2" size={16} color="#cbd5e1" />
            <Text style={styles.secondaryText}>Edit</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryButton, routes.length === 0 && styles.primaryButtonDisabled]}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              startNavigation();
            }}
            disabled={routes.length === 0}
          >
            <Feather name="navigation" size={18} color="#04121f" />
            <Text style={styles.primaryText}>Start</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Blue Road / Yellow Off-road / Red Walking path legend. */
export function SurfaceLegend() {
  return (
    <View style={styles.legend} pointerEvents="none">
      {SURFACE_LEGEND.map((surface) => (
        <View key={surface} style={styles.legendRow}>
          <View style={[styles.legendSwatch, { backgroundColor: SURFACE_COLORS[surface] }]} />
          <Text style={styles.legendLabel}>{SURFACE_LABELS[surface]}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    position: "absolute",
    left: 12,
    bottom: BOTTOM_BAR_HEIGHT + 175,
    backgroundColor: "rgba(8,14,26,0.86)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    paddingVertical: 9,
    paddingHorizontal: 11,
    gap: 7,
  },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendSwatch: { width: 18, height: 5, borderRadius: 3 },
  legendLabel: { color: "#dbe7f5", fontSize: 11.5, fontWeight: "700" },
  chipColumn: {
    position: "absolute",
    right: 12,
    bottom: BOTTOM_BAR_HEIGHT + 145,
    gap: 9,
    alignItems: "flex-end",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(8,14,26,0.92)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    paddingVertical: 8,
    paddingHorizontal: 10,
    minWidth: 116,
  },
  chipSelected: { borderColor: "rgba(96,165,250,0.85)", backgroundColor: "rgba(15,28,48,0.96)" },
  chipBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "rgba(148,163,184,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  chipBadgeSelected: { borderColor: "#60a5fa" },
  chipBadgeText: { color: "#cbd5e1", fontSize: 13, fontWeight: "900" },
  chipBadgeTextSelected: { color: "#60a5fa" },
  chipDistance: { color: "#EFF6FF", fontSize: 15, fontWeight: "900" },
  chipEtaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  chipEta: { color: "#94a3b8", fontSize: 11.5, fontWeight: "700" },
  actionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: BOTTOM_BAR_HEIGHT,
    backgroundColor: "#0a1322",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 18,
    zIndex: 60,
  },
  transportRow: { marginBottom: 12 },
  error: { color: "#f87171", fontSize: 12.5, fontWeight: "700", marginBottom: 10, textAlign: "center" },
  actionRow: { flexDirection: "row", gap: 10 },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "#111d31",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
  },
  secondaryText: { color: "#cbd5e1", fontSize: 13.5, fontWeight: "800" },
  primaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: "#34d399",
    shadowColor: "#34d399",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  primaryButtonDisabled: { backgroundColor: "#1f4f43" },
  primaryText: { color: "#04121f", fontSize: 15.5, fontWeight: "900", letterSpacing: 0.3 },
});
