import React, { useState } from "react";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavStore } from "./nav-store";
import { useLocationStatus } from "../debug/location-status";
import { formatDistance, formatDuration, formatEta } from "./geo";
import { maneuverGlyph, maneuverLabel, SURFACE_COLORS, SURFACE_LABELS } from "./surface";

const SCREEN_W = Dimensions.get("window").width;
/** Bottom inset for nav UI — the tracks tab bar is hidden during navigation. */
const NAV_BOTTOM_INSET = 12;
const STATUS_BAR_HEIGHT = 86;
const PAGE_WIDTH = SCREEN_W - 24;
/** Reference distance over which the maneuver progress bar fills (metres). */
const MANEUVER_BAR_REFERENCE_M = 400;

/** Full active-navigation overlay: next-turn card + swipable status bar + end control. */
export function ActiveNavOverlay() {
  const phase = useNavStore((s) => s.phase);
  const routes = useNavStore((s) => s.routes);
  const selectedRouteId = useNavStore((s) => s.selectedRouteId);
  const progress = useNavStore((s) => s.progress);
  const stop = useNavStore((s) => s.stop);

  if (phase !== "active") return null;
  const route = routes.find((r) => r.id === selectedRouteId) ?? routes[0];
  if (!route) return null;

  const instruction = progress ? route.instructions[progress.instructionIndex] : route.instructions[0];
  const maneuver = instruction?.maneuver ?? "continue";
  const toManeuver = progress?.toManeuverMeters ?? 0;
  const barFill = Math.max(0.04, Math.min(1, 1 - toManeuver / MANEUVER_BAR_REFERENCE_M));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Next-turn card — top-left, just under the standard top bar. */}
      <View style={styles.turnCard}>
        <View style={styles.turnRow}>
          <View style={styles.arrowBadge}>
            <Text style={styles.arrowGlyph}>{maneuverGlyph(maneuver)}</Text>
          </View>
          <View style={styles.turnTextWrap}>
            <Text style={styles.turnDistance}>{progress ? formatDistance(toManeuver) : "—"}</Text>
            <Text style={styles.turnLabel} numberOfLines={1}>
              {maneuverLabel(maneuver)}
            </Text>
          </View>
        </View>
        {instruction?.streetName ? (
          <Text style={styles.turnStreet} numberOfLines={1}>
            {instruction.streetName}
          </Text>
        ) : null}
        <View style={styles.maneuverTrack}>
          <View style={[styles.maneuverFill, { width: `${barFill * 100}%` }]} />
        </View>
        {progress?.offRoute ? (
          <View style={styles.offRoutePill}>
            <Feather name="alert-triangle" size={11} color="#fca5a5" />
            <Text style={styles.offRouteText}>Off route — rejoin the line</Text>
          </View>
        ) : null}
      </View>

      {/* End navigation — bold red action, bottom-right above the status bar. */}
      <Pressable
        style={({ pressed }) => [styles.endButton, pressed && styles.endButtonPressed]}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          stop();
        }}
        hitSlop={8}
      >
        <View style={styles.endStopIcon} />
        <Text style={styles.endText}>End</Text>
      </Pressable>

      <NavStatusBar />
    </View>
  );
}

/** Swipable bottom status bar. Page 1: speed/distance/ETA, then extra metrics. */
function NavStatusBar() {
  const progress = useNavStore((s) => s.progress);
  const routes = useNavStore((s) => s.routes);
  const selectedRouteId = useNavStore((s) => s.selectedRouteId);
  const fix = useLocationStatus((s) => s.lastFix);
  const [page, setPage] = useState(0);

  const route = routes.find((r) => r.id === selectedRouteId) ?? routes[0];
  const speedKmh = progress?.speedMps != null ? (progress.speedMps * 3.6).toFixed(1) : "—";
  const remaining = progress ? formatDistance(progress.remainingMeters) : "—";
  const eta = progress ? formatEta(progress.remainingMs) : "—";
  const surface = progress?.surface ?? "road";

  const pages: Array<Array<{ icon: keyof typeof Feather.glyphMap; value: string; unit: string }>> = [
    // 1 — the essentials: speed, what's left, how long it takes, when you arrive.
    [
      { icon: "activity", value: speedKmh, unit: "km/h" },
      { icon: "navigation-2", value: remaining, unit: "remaining" },
      { icon: "flag", value: progress ? formatDuration(progress.remainingMs) : "—", unit: "to dest" },
      { icon: "clock", value: eta, unit: "ETA" },
    ],
    // 2 — terrain ahead: climb/descent and what's under the wheels.
    [
      { icon: "trending-up", value: route?.ascentMeters != null ? `${Math.round(route.ascentMeters)}` : "—", unit: "ascent m" },
      { icon: "trending-down", value: route?.descentMeters != null ? `${Math.round(route.descentMeters)}` : "—", unit: "descent m" },
      { icon: "layers", value: SURFACE_LABELS[surface], unit: "surface" },
    ],
    // 3 — device & signal health: GPS quality, heading, battery.
    [
      { icon: "target", value: fix?.accuracy != null ? `±${Math.round(fix.accuracy)}` : "—", unit: "GPS m" },
      { icon: "compass", value: progress ? `${Math.round(progress.bearing)}°` : "—", unit: "bearing" },
      { icon: "battery", value: fix?.battery != null ? `${Math.round(fix.battery * 100)}%` : "—", unit: "battery" },
    ],
  ];

  return (
    <View style={styles.statusWrap}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / PAGE_WIDTH))}
      >
        {pages.map((cells, pageIndex) => (
          <View key={pageIndex} style={[styles.statusPage, { width: PAGE_WIDTH }]}>
            {cells.map((cell, cellIndex) => (
              <View key={cellIndex} style={styles.statusCell}>
                <Feather name={cell.icon} size={15} color="#64748b" />
                <Text
                  style={[styles.statusValue, cell.unit === "surface" && { color: SURFACE_COLORS[surface] }]}
                  numberOfLines={1}
                >
                  {cell.value}
                </Text>
                <Text style={styles.statusUnit}>{cell.unit}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {pages.map((_, i) => (
          <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  turnCard: {
    position: "absolute",
    // Just under the top bar — the medic status button that used to occupy
    // this slot is hidden during active navigation.
    top: 70,
    left: 12,
    minWidth: 184,
    maxWidth: 250,
    backgroundColor: "rgba(9,14,24,0.96)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    paddingVertical: 12,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  turnRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  arrowBadge: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: "#f5b301",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#f5b301",
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  arrowGlyph: { color: "#1a1206", fontSize: 30, fontWeight: "900", lineHeight: 34 },
  turnTextWrap: { flex: 1 },
  turnDistance: { color: "#FFFFFF", fontSize: 27, fontWeight: "900", letterSpacing: 0.3, lineHeight: 30 },
  turnLabel: { color: "#9fb3cc", fontSize: 13, fontWeight: "800", marginTop: 1 },
  turnStreet: { color: "#dbe7f5", fontSize: 12.5, fontWeight: "700", marginTop: 8 },
  maneuverTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(148,163,184,0.18)",
    marginTop: 10,
    overflow: "hidden",
  },
  maneuverFill: { height: 4, borderRadius: 2, backgroundColor: "#f5b301" },
  offRoutePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 9,
    alignSelf: "flex-start",
    backgroundColor: "rgba(248,113,113,0.14)",
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  offRouteText: { color: "#fca5a5", fontSize: 11, fontWeight: "800" },
  endButton: {
    position: "absolute",
    right: 14,
    bottom: NAV_BOTTOM_INSET + STATUS_BAR_HEIGHT + 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 12,
    paddingHorizontal: 19,
    borderRadius: 17,
    backgroundColor: "#ef4444",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    shadowColor: "#ef4444",
    shadowOpacity: 0.55,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 14,
    zIndex: 30,
  },
  endButtonPressed: { backgroundColor: "#dc2626", transform: [{ scale: 0.96 }] },
  endStopIcon: { width: 13, height: 13, borderRadius: 3.5, backgroundColor: "#fff" },
  endText: { color: "#ffffff", fontSize: 15, fontWeight: "900", letterSpacing: 0.4 },
  statusWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: NAV_BOTTOM_INSET,
    backgroundColor: "rgba(9,14,24,0.96)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    paddingTop: 12,
    paddingBottom: 8,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 16,
  },
  statusPage: { flexDirection: "row", justifyContent: "space-around", alignItems: "center" },
  statusCell: { flex: 1, alignItems: "center", gap: 3 },
  statusValue: { color: "#FFFFFF", fontSize: 21, fontWeight: "900" },
  statusUnit: { color: "#64748b", fontSize: 11, fontWeight: "700" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(148,163,184,0.35)" },
  dotActive: { backgroundColor: "#3B82F6", width: 18 },
});
