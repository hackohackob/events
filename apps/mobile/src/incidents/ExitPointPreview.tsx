import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { createPoi, type PoiDto } from "../ui/event-actions";
import { debugLog } from "../debug/debug-log";
import { exitLabel, type AsphaltPoint } from "./IncidentSheet";

interface Props {
  point: AsphaltPoint;
  /** Distance from the screen bottom — sits just above the open drawer. */
  bottom: number;
  onClose: () => void;
  /** A POI was created here (parent drops it on the map immediately). */
  onPoiCreated?: (poi: PoiDto) => void;
}

const ROUTED_COLOR = "#818cf8";
const DIRECT_COLOR = "#f59e0b";
const CHART_HEIGHT = 44;

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

/**
 * Floating preview for the selected "closest asphalt" exit point. Lives OUTSIDE
 * the incident drawer (so the drawer can stay at its half snap) and shows the
 * point's metrics, a compact elevation profile of the walk path, and a
 * one-tap "extraction point" POI drop.
 */
export function ExitPointPreview({ point, bottom, onClose, onPoiCreated }: Props) {
  const [savingPoi, setSavingPoi] = useState(false);
  const [poiSaved, setPoiSaved] = useState(false);
  const direct = point.incident.direct;
  const accent = direct ? DIRECT_COLOR : ROUTED_COLOR;

  // Elevation series → stepped bars. Same trick the track profile uses (no SVG
  // dependency in this app): one thin View per sample, height = normalised gain.
  const chart = useMemo(() => {
    const elevations = point.path?.elevations;
    if (!elevations || elevations.length < 4) return null;
    const SAMPLES = 34;
    const step = (elevations.length - 1) / (SAMPLES - 1);
    const sampled = Array.from({ length: SAMPLES }, (_, i) => elevations[Math.round(i * step)]);
    const min = Math.min(...sampled);
    const max = Math.max(...sampled);
    const span = Math.max(1, max - min);
    return {
      bars: sampled.map((value) => Math.max(2, ((value - min) / span) * CHART_HEIGHT)),
      min: Math.round(min),
      max: Math.round(max),
    };
  }, [point.path]);

  const addExtractionPoi = async () => {
    if (savingPoi || poiSaved) return;
    setSavingPoi(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const poi = await createPoi({
        lat: point.lat,
        lng: point.lng,
        // The ambulance type renders the ambulance glyph on every client.
        type: "ambulance",
        name: `Extraction point ${point.index}`,
        description: direct
          ? `Straight-line access, ${formatDistance(point.incident.distanceMeters)} from the incident.`
          : `${formatDistance(point.incident.distanceMeters)} on foot from the incident.`,
      });
      setPoiSaved(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onPoiCreated?.(poi);
    } catch (err) {
      debugLog("api", "error", "extraction POI failed", String(err));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSavingPoi(false);
    }
  };

  return (
    <View style={[styles.card, { bottom, borderColor: `${accent}66` }]} pointerEvents="box-none">
      <View style={styles.headerRow}>
        <View style={[styles.badge, { backgroundColor: accent }]}>
          <Text style={styles.badgeText} allowFontScaling={false}>{point.index}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{exitLabel(point)}</Text>
          <Text style={[styles.subtitle, { color: accent }]} numberOfLines={1}>
            {direct
              ? `${formatDistance(point.incident.distanceMeters)} straight line${point.incident.noRoad ? " · no path" : ""}`
              : point.incident.distanceMeters < 30
                ? "Incident is already on this road"
                : `${Math.max(1, Math.round((point.incident.durationMs ?? 0) / 60000))} min · ${formatDistance(point.incident.distanceMeters)} on foot`}
          </Text>
        </View>

        {/* Drop an "extraction point" POI here (pin-with-plus). */}
        <Pressable
          style={[styles.actionBtn, poiSaved && styles.actionBtnDone]}
          onPress={() => void addExtractionPoi()}
          disabled={savingPoi || poiSaved}
          hitSlop={6}
        >
          {savingPoi ? (
            <ActivityIndicator size="small" color="#34d399" />
          ) : (
            <MaterialCommunityIcons
              name={poiSaved ? "check" : "map-marker-plus"}
              size={19}
              color={poiSaved ? "#04121f" : "#34d399"}
            />
          )}
        </Pressable>
        <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
          <Feather name="x" size={16} color="#94a3b8" />
        </Pressable>
      </View>

      {/* Elevation profile of the walk path (routed points only). */}
      {chart ? (
        <View style={styles.chartBlock}>
          <View style={styles.chartRow}>
            {chart.bars.map((height, i) => (
              <View key={i} style={[styles.bar, { height, backgroundColor: accent }]} />
            ))}
          </View>
          <View style={styles.chartLabels}>
            <Text style={styles.chartLabel}>{chart.min} m</Text>
            <Text style={styles.chartLabel}>
              {point.path?.ascentMeters != null ? `↑ ${point.path.ascentMeters} m` : "elevation"}
              {point.path?.descentMeters != null ? `   ↓ ${point.path.descentMeters} m` : ""}
            </Text>
            <Text style={styles.chartLabel}>{chart.max} m</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.noChartText}>
          {direct
            ? "No path — the line shown is straight-line distance."
            : "No elevation data for this path."}
        </Text>
      )}

      {point.fromMe ? (
        <View style={styles.driveRow}>
          <Feather name="truck" size={12} color="#94a3b8" />
          <Text style={styles.driveText}>
            You by car: {Math.max(1, Math.round(point.fromMe.durationMs / 60000))} min ·{" "}
            {formatDistance(point.fromMe.distanceMeters)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 40,
    backgroundColor: "rgba(8, 15, 28, 0.97)",
    borderRadius: 18,
    borderWidth: 1.5,
    paddingHorizontal: 13,
    paddingVertical: 12,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#ffffff", fontSize: 13, fontWeight: "900", includeFontPadding: false },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: "#E9F1FA", fontSize: 14.5, fontWeight: "900", textTransform: "capitalize" },
  subtitle: { fontSize: 12, fontWeight: "700", marginTop: 1 },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(52,211,153,0.14)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.35)",
  },
  actionBtnDone: { backgroundColor: "#34d399", borderColor: "#34d399" },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },

  chartBlock: { gap: 5 },
  chartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: CHART_HEIGHT,
    gap: 1.5,
  },
  bar: { flex: 1, borderRadius: 1.5, opacity: 0.85, minWidth: 2 },
  chartLabels: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chartLabel: { color: "#5b6b80", fontSize: 9.5, fontWeight: "700" },
  noChartText: { color: "#5b6b80", fontSize: 11.5, fontWeight: "600" },

  driveRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  driveText: { color: "#94a3b8", fontSize: 12, fontWeight: "600" },
});
