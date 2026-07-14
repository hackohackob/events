import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavStore } from "./nav-store";
import { useLocationStatus } from "../debug/location-status";
import { formatDistance, formatDuration, formatEta } from "./geo";
import { maneuverGlyph, maneuverLabel, SURFACE_COLORS } from "./surface";

/** Bottom inset for nav UI — the tabs bar is hidden during navigation. */
const NAV_BOTTOM_INSET = 10;
/** Reference distance over which the maneuver progress bar fills (metres). */
const MANEUVER_BAR_REFERENCE_M = 400;

/**
 * Active-navigation HUD.
 *
 *  ┌──────────────────────────────┐   Maneuver banner: big arrow + distance,
 *  │ ⬏  240 m                     │   street, per-maneuver progress fill and
 *  │    Turn left · Vitosha blvd  │   a "then ↱" lookahead chip. Turns green
 *  └──────────────────────────────┘   on final approach; a flashing strip
 *                                     appears under it when off-route.
 *      (map)
 *
 *   ⌀ 34         Speed puck (ringed in the current surface colour).
 *  ┌──────────────────────────────┐
 *  │ ━━━━━━━━━━━░░░░░░░░░░░░░░░░ │   Whole-route progress.
 *  │ 14:32 ETA · 3.4 km · 12 min  │   Tap the dock for terrain/GPS details.
 *  │                    🔇  ■ End │
 *  └──────────────────────────────┘
 */
export function ActiveNavOverlay() {
  const phase = useNavStore((s) => s.phase);
  const routes = useNavStore((s) => s.routes);
  const selectedRouteId = useNavStore((s) => s.selectedRouteId);
  const progress = useNavStore((s) => s.progress);
  const rerouting = useNavStore((s) => s.rerouting);
  const voiceMuted = useNavStore((s) => s.voiceMuted);
  const toggleVoiceMuted = useNavStore((s) => s.toggleVoiceMuted);
  const destination = useNavStore((s) => s.destination);
  const stop = useNavStore((s) => s.stop);

  if (phase !== "active") return null;
  const route = routes.find((r) => r.id === selectedRouteId) ?? routes[0];
  if (!route) return null;

  const instructionIndex = progress?.instructionIndex ?? 0;
  const instruction = route.instructions[instructionIndex];
  const nextInstruction = route.instructions[instructionIndex + 1];
  const maneuver = instruction?.maneuver ?? "continue";
  const toManeuver = progress?.toManeuverMeters ?? 0;
  const barFill = Math.max(0.04, Math.min(1, 1 - toManeuver / MANEUVER_BAR_REFERENCE_M));
  // Final approach: paint the banner green so "you're there" is unmissable.
  const arriving = maneuver === "arrive" && (progress?.remainingMeters ?? Infinity) < 120;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* ── Maneuver banner ── */}
      <View style={[styles.banner, arriving && styles.bannerArrive]}>
        <View style={styles.bannerRow}>
          <View style={[styles.arrowBadge, arriving && styles.arrowBadgeArrive]}>
            <Text style={styles.arrowGlyph} allowFontScaling={false}>{maneuverGlyph(maneuver)}</Text>
          </View>
          <View style={styles.bannerTextWrap}>
            <Text style={styles.bannerDistance} allowFontScaling={false}>
              {progress ? formatDistance(toManeuver) : "—"}
            </Text>
            <Text style={styles.bannerLabel} numberOfLines={1}>
              {arriving
                ? (destination?.label ? `Arrive · ${destination.label}` : "Arrive at destination")
                : instruction?.streetName
                  ? `${maneuverLabel(maneuver)} · ${instruction.streetName}`
                  : maneuverLabel(maneuver)}
            </Text>
          </View>
          {/* Lookahead: what comes right after this maneuver. */}
          {nextInstruction && !arriving ? (
            <View style={styles.thenChip}>
              <Text style={styles.thenChipCaption}>then</Text>
              <Text style={styles.thenChipGlyph} allowFontScaling={false}>
                {maneuverGlyph(nextInstruction.maneuver)}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.maneuverTrack}>
          <View style={[styles.maneuverFill, arriving && styles.maneuverFillArrive, { width: `${barFill * 100}%` }]} />
        </View>
      </View>

      {/* Off-route / rerouting strip, right under the banner. */}
      {progress?.offRoute || rerouting ? (
        <OffRouteStrip meters={progress?.offRouteMeters ?? 0} rerouting={rerouting} />
      ) : null}

      {/* ── Bottom: speed puck + voice toggle floating above the dock ── */}
      <View style={styles.bottomStack} pointerEvents="box-none">
        <View style={styles.floatRow} pointerEvents="box-none">
          <SpeedPuck speedMps={progress?.speedMps ?? null} surface={progress?.surface ?? "road"} />
          <Pressable
            style={styles.voiceBtn}
            onPress={() => {
              void Haptics.selectionAsync();
              toggleVoiceMuted();
            }}
            hitSlop={8}
          >
            <Feather name={voiceMuted ? "volume-x" : "volume-2"} size={19} color={voiceMuted ? "#f5b301" : "#cfe0f4"} />
          </Pressable>
        </View>
        <NavDock
          route={route}
          progressState={progress}
          onEnd={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            stop();
          }}
        />
      </View>
    </View>
  );
}

/** Flashing "return to path" strip shown when the user strays off the route. */
function OffRouteStrip({ meters, rerouting }: { meters: number; rerouting: boolean }) {
  const flash = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flash, { toValue: 0.45, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(flash, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [flash]);

  return (
    <Animated.View style={[styles.offRouteStrip, { opacity: flash }]}>
      <Feather name={rerouting ? "refresh-cw" : "alert-triangle"} size={13} color="#fff" />
      <Text style={styles.offRouteText}>
        {rerouting ? "Finding a new route…" : `Off route · ${Math.round(meters)} m from the path`}
      </Text>
    </Animated.View>
  );
}

/** Current speed in a floating circular puck, ringed in the surface colour. */
function SpeedPuck({ speedMps, surface }: { speedMps: number | null; surface: keyof typeof SURFACE_COLORS }) {
  const kmh = speedMps != null && speedMps > 0.4 ? Math.round(speedMps * 3.6) : 0;
  return (
    <View style={[styles.speedPuck, { borderColor: SURFACE_COLORS[surface] }]}>
      <Text style={styles.speedValue} allowFontScaling={false}>{kmh}</Text>
      <Text style={styles.speedUnit} allowFontScaling={false}>km/h</Text>
    </View>
  );
}

function NavDock({
  route,
  progressState,
  onEnd,
}: {
  route: { distanceMeters: number; durationMs: number; ascentMeters?: number; descentMeters?: number };
  progressState: ReturnType<typeof useNavStore.getState>["progress"];
  onEnd: () => void;
}) {
  const fix = useLocationStatus((s) => s.lastFix);
  const [expanded, setExpanded] = useState(false);

  const remainingMeters = progressState?.remainingMeters ?? route.distanceMeters;
  const remainingMs = progressState?.remainingMs ?? route.durationMs;
  const routeFraction =
    route.distanceMeters > 0
      ? Math.max(0, Math.min(1, 1 - remainingMeters / route.distanceMeters))
      : 0;

  return (
    <Pressable
      style={styles.dock}
      onPress={() => {
        void Haptics.selectionAsync();
        setExpanded((v) => !v);
      }}
    >
      {/* Whole-route progress. */}
      <View style={styles.routeTrack}>
        <View style={[styles.routeFill, { width: `${Math.max(1.5, routeFraction * 100)}%` }]} />
      </View>

      <View style={styles.dockRow}>
        <View style={styles.dockStats}>
          <View style={styles.etaGroup}>
            <Text style={styles.etaValue} allowFontScaling={false}>
              {progressState ? formatEta(remainingMs) : "—"}
            </Text>
            <Text style={styles.etaCaption}>ETA</Text>
          </View>
          <View style={styles.dockDivider} />
          <View style={styles.statGroup}>
            <Text style={styles.statValue} allowFontScaling={false}>{formatDistance(remainingMeters)}</Text>
            <Text style={styles.statCaption}>left</Text>
          </View>
          <View style={styles.dockDivider} />
          <View style={styles.statGroup}>
            <Text style={styles.statValue} allowFontScaling={false}>{formatDuration(remainingMs)}</Text>
            <Text style={styles.statCaption}>time</Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.endBtn, pressed && styles.endBtnPressed]}
          onPress={onEnd}
          hitSlop={6}
        >
          <View style={styles.endStopIcon} />
          <Text style={styles.endText}>End</Text>
        </Pressable>
      </View>

      {/* Tap-to-expand: terrain + GPS details. */}
      {expanded ? (
        <View style={styles.detailRow}>
          <DetailCell icon="trending-up" value={route.ascentMeters != null ? `${Math.round(route.ascentMeters)} m` : "—"} caption="climb" />
          <DetailCell icon="trending-down" value={route.descentMeters != null ? `${Math.round(route.descentMeters)} m` : "—"} caption="descent" />
          <DetailCell icon="target" value={fix?.accuracy != null ? `±${Math.round(fix.accuracy)} m` : "—"} caption="GPS" />
        </View>
      ) : null}
    </Pressable>
  );
}

function DetailCell({
  icon,
  value,
  caption,
  color,
}: {
  icon: keyof typeof Feather.glyphMap;
  value: string;
  caption: string;
  color?: string;
}) {
  return (
    <View style={styles.detailCell}>
      <Feather name={icon} size={13} color="#64748b" />
      <Text style={[styles.detailValue, color ? { color } : null]} numberOfLines={1} allowFontScaling={false}>
        {value}
      </Text>
      <Text style={styles.detailCaption}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Maneuver banner ──
  banner: {
    position: "absolute",
    top: 66,
    left: 12,
    // Leaves the right-hand map controls column (layers / locate / compass,
    // 46px wide at right:12) fully clear.
    right: 70,
    borderRadius: 20,
    backgroundColor: "rgba(7, 12, 22, 0.97)",
    borderWidth: 1,
    borderColor: "rgba(245, 179, 1, 0.35)",
    paddingTop: 12,
    paddingHorizontal: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 18,
  },
  bannerArrive: { borderColor: "rgba(52, 211, 153, 0.55)" },
  bannerRow: { flexDirection: "row", alignItems: "center", gap: 13, paddingBottom: 12 },
  arrowBadge: {
    width: 76,
    height: 76,
    borderRadius: 20,
    backgroundColor: "#f5b301",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#f5b301",
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  arrowBadgeArrive: { backgroundColor: "#34d399", shadowColor: "#34d399" },
  arrowGlyph: { color: "#1a1206", fontSize: 52, fontWeight: "900", lineHeight: 60 },
  bannerTextWrap: { flex: 1, minWidth: 0 },
  bannerDistance: { color: "#ffffff", fontSize: 32, fontWeight: "900", letterSpacing: 0.2, lineHeight: 36 },
  bannerLabel: { color: "#9fb3cc", fontSize: 13.5, fontWeight: "800", marginTop: 1 },
  thenChip: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
    gap: 1,
  },
  thenChipCaption: { color: "#64748b", fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  thenChipGlyph: { color: "#dbe7f5", fontSize: 19, fontWeight: "900", lineHeight: 22 },
  maneuverTrack: { height: 4, backgroundColor: "rgba(148,163,184,0.16)", marginHorizontal: -14 },
  maneuverFill: { height: 4, backgroundColor: "#f5b301" },
  maneuverFillArrive: { backgroundColor: "#34d399" },

  // ── Off-route strip ──
  offRouteStrip: {
    position: "absolute",
    top: 152,
    left: 26,
    right: 84,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(220, 38, 38, 0.95)",
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 14,
    shadowColor: "#ef4444",
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
  offRouteText: { color: "#fff", fontSize: 12.5, fontWeight: "900", letterSpacing: 0.2 },

  // ── Bottom stack ──
  bottomStack: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: NAV_BOTTOM_INSET,
    gap: 10,
  },
  // Speed puck bottom-left, voice toggle bottom-right — both floating above
  // the dock so the dock row stays uncrowded.
  floatRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 2,
  },
  speedPuck: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 3,
    backgroundColor: "rgba(7, 12, 22, 0.96)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  speedValue: { color: "#ffffff", fontSize: 19, fontWeight: "900", lineHeight: 22 },
  speedUnit: { color: "#64748b", fontSize: 9, fontWeight: "800", marginTop: -1 },

  // ── Dock ──
  dock: {
    borderRadius: 22,
    backgroundColor: "rgba(7, 12, 22, 0.97)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 18,
  },
  routeTrack: { height: 3.5, backgroundColor: "rgba(148,163,184,0.14)" },
  routeFill: { height: 3.5, backgroundColor: "#34d399" },
  dockRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  dockStats: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  etaGroup: { alignItems: "flex-start" },
  etaValue: { color: "#34d399", fontSize: 23, fontWeight: "900", lineHeight: 26 },
  etaCaption: { color: "#4d6076", fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  dockDivider: { width: 1, height: 26, backgroundColor: "rgba(148,163,184,0.16)" },
  statGroup: { alignItems: "flex-start" },
  statValue: { color: "#eef4fb", fontSize: 16.5, fontWeight: "900", lineHeight: 20 },
  statCaption: { color: "#4d6076", fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  voiceBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(7, 12, 22, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.25)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  endBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 11,
    paddingHorizontal: 15,
    borderRadius: 14,
    backgroundColor: "#ef4444",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    shadowColor: "#ef4444",
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  endBtnPressed: { backgroundColor: "#dc2626", transform: [{ scale: 0.96 }] },
  endStopIcon: { width: 11, height: 11, borderRadius: 3, backgroundColor: "#fff" },
  endText: { color: "#ffffff", fontSize: 14, fontWeight: "900", letterSpacing: 0.4 },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingBottom: 11,
    paddingTop: 3,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(148,163,184,0.1)",
  },
  detailCell: { alignItems: "center", gap: 2, minWidth: 56 },
  detailValue: { color: "#eef4fb", fontSize: 13, fontWeight: "900" },
  detailCaption: { color: "#4d6076", fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
});
