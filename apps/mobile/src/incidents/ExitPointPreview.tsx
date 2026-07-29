import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { createPoi, type PoiDto } from "../ui/event-actions";
import { debugLog } from "../debug/debug-log";
import { exitColor, exitLabel, formatDistance, formatMinutes, surfaceNote, type AsphaltPoint } from "./IncidentSheet";
import { slopeColor } from "../map/slope-shading";

interface Props {
  point: AsphaltPoint;
  /**
   * The drawer's live top edge (container coordinates). The card rides on it, so
   * it stays welded to the drawer at every snap point and while it is dragged.
   */
  sheetTop: SharedValue<number>;
  onClose: () => void;
  /** A POI was created here (parent drops it on the map immediately). */
  onPoiCreated?: (poi: PoiDto) => void;
}

const CHART_HEIGHT = 26;

/**
 * Floating preview for the selected "closest asphalt" exit point. Lives OUTSIDE
 * the incident drawer (so the drawer can stay at its half snap) and shows the
 * point's metrics, a compact elevation profile of the walk path, and a
 * one-tap "extraction point" POI drop.
 */
export function ExitPointPreview({ point, sheetTop, onClose, onPoiCreated }: Props) {
  const [savingPoi, setSavingPoi] = useState(false);
  // Measured so the card can sit exactly on the drawer regardless of how many
  // rows it ends up with (chart, off-path note, surface note).
  const [height, setHeight] = useState(0);
  const [poiSaved, setPoiSaved] = useState(false);
  const direct = point.incident.direct;
  const accent = exitColor(point);

  // Elevation series → stepped bars. Same trick the track profile uses (no SVG
  // dependency in this app): one thin View per sample, height = normalised gain.
  // Only the SHAPE matters here — absolute start/end altitudes are noise for a
  // medic deciding on an extraction, so they are not labelled.
  const bars = useMemo(() => {
    const elevations = point.path?.elevations;
    if (!elevations || elevations.length < 4) return null;
    const SAMPLES = 34;
    const step = (elevations.length - 1) / (SAMPLES - 1);
    const sampled = Array.from({ length: SAMPLES }, (_, i) => elevations[Math.round(i * step)]);
    const min = Math.min(...sampled);
    const span = Math.max(1, Math.max(...sampled) - min);
    // Each bar is shaded by its own rise/fall, with the same climb-dark /
    // descent-light language the map line and the race tracks use — so the
    // profile and the drawn path read as one picture.
    const maxDelta = Math.max(
      1,
      ...sampled.slice(1).map((value, i) => Math.abs(value - sampled[i])),
    );
    return sampled.map((value, i) => ({
      height: Math.max(2, ((value - min) / span) * CHART_HEIGHT),
      color: slopeColor(accent, i === 0 ? 0 : (value - sampled[i - 1]) / maxDelta),
    }));
  }, [point.path, accent]);

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
        // Spell out both paces + the carry: this text is what the rest of the
        // team reads off the map later, without the drawer's context.
        description: direct
          ? `Straight-line access, ${formatDistance(point.incident.distanceMeters)} from the incident — no route.`
          : [
              `${formatDistance(point.incident.distanceMeters)} from the incident`,
              point.incident.foot ? `${formatMinutes(point.incident.foot.durationMs)} on foot` : null,
              point.incident.bike ? `${formatMinutes(point.incident.bike.durationMs)} by bike` : null,
              point.incident.offPathSignificant && point.incident.offPathMeters
                ? `first ${formatDistance(point.incident.offPathMeters)} off-path`
                : null,
              point.confidence === "unknown" ? "surface unverified" : null,
            ]
              .filter(Boolean)
              .join(" · ") + ".",
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

  const surface = surfaceNote(point);
  const footnote = [
    point.incident.offPathSignificant && point.incident.offPathMeters
      ? `first ${formatDistance(point.incident.offPathMeters)} off-path`
      : null,
    point.confidence === "unknown" ? "surface unverified" : surface,
  ]
    .filter(Boolean)
    .join("  ·  ");

  // Hidden for the single frame before onLayout reports a height, so the card
  // doesn't flash at the wrong offset on open.
  const glued = useAnimatedStyle(() => ({
    opacity: height > 0 ? 1 : 0,
    transform: [{ translateY: sheetTop.value - height }],
  }));

  return (
    <Animated.View
      style={[styles.card, glued, { borderColor: `${accent}66` }]}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      pointerEvents="box-none"
    >
      <View style={styles.headerRow}>
        <View style={[styles.badge, { backgroundColor: accent }]}>
          <Text
            style={[styles.badgeText, point.best && styles.badgeTextBest]}
            allowFontScaling={false}
          >
            {point.index}
          </Text>
        </View>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>{exitLabel(point)}</Text>
            {point.best ? (
              <View style={[styles.chip, { backgroundColor: accent }]}>
                <Text style={styles.chipText} allowFontScaling={false}>BEST</Text>
              </View>
            ) : null}
          </View>

          {/* Foot and bike each keep their own number — the two profiles route
              over different networks, so a single blended figure fitted neither. */}
          {direct ? (
            <Text style={[styles.subtitle, { color: accent }]} numberOfLines={1}>
              {formatDistance(point.incident.distanceMeters)} straight line · no route
            </Text>
          ) : point.incident.distanceMeters < 30 ? (
            <Text style={[styles.subtitle, { color: accent }]} numberOfLines={1}>
              Incident is already on this road
            </Text>
          ) : (
            <View style={styles.paceRow}>
              {point.incident.foot ? (
                <View style={styles.pace}>
                  <MaterialCommunityIcons name="walk" size={12} color={accent} />
                  <Text style={[styles.paceText, { color: accent }]} allowFontScaling={false}>
                    {formatMinutes(point.incident.foot.durationMs)}
                  </Text>
                </View>
              ) : null}
              {point.incident.bike ? (
                <View style={styles.pace}>
                  <MaterialCommunityIcons name="bike" size={12} color={accent} />
                  <Text style={[styles.paceText, { color: accent }]} allowFontScaling={false}>
                    {formatMinutes(point.incident.bike.durationMs)}
                  </Text>
                </View>
              ) : null}
              <Text style={styles.paceMeta} numberOfLines={1}>
                {formatDistance(point.incident.distanceMeters)}
                {point.fromMe ? `  ·  🚗 ${formatMinutes(point.fromMe.durationMs)}` : ""}
              </Text>
            </View>
          )}
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

      {/* Elevation profile of the walk path (routed points only). Only the
          climb/drop is labelled — start/end altitude took a whole extra row and
          told the medic nothing actionable. */}
      {bars ? (
        <View style={styles.chartRow}>
          <View style={styles.chartBars}>
            {bars.map((bar, i) => (
              <View key={i} style={[styles.bar, { height: bar.height, backgroundColor: bar.color }]} />
            ))}
          </View>
          <Text style={styles.chartLabel} allowFontScaling={false}>
            {point.path?.ascentMeters != null ? `↑${point.path.ascentMeters}` : ""}
            {point.path?.descentMeters != null ? ` ↓${point.path.descentMeters}` : ""}
            {point.path?.ascentMeters != null || point.path?.descentMeters != null ? " m" : ""}
          </Text>
        </View>
      ) : direct ? (
        <Text style={styles.noChartText}>Straight-line distance — no route.</Text>
      ) : null}

      {footnote ? <Text style={styles.noChartText} numberOfLines={1}>{footnote}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Parked flush on top of the open drawer (`bottom` is the drawer height), so
  // the two read as one stacked surface — hence square bottom corners.
  card: {
    position: "absolute",
    top: 0,
    left: 8,
    right: 8,
    zIndex: 40,
    backgroundColor: "rgba(8, 15, 28, 0.97)",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    paddingHorizontal: 10,
    paddingTop: 7,
    paddingBottom: 6,
    gap: 5,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 12,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#ffffff", fontSize: 11, fontWeight: "900", includeFontPadding: false },
  badgeTextBest: { color: "#04121f" },
  headerText: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { color: "#E9F1FA", fontSize: 13, fontWeight: "900", textTransform: "capitalize", flexShrink: 1 },
  chip: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  chipText: { color: "#04121f", fontSize: 8, fontWeight: "900", letterSpacing: 0.5 },
  subtitle: { fontSize: 11, fontWeight: "700" },
  paceRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 1 },
  pace: { flexDirection: "row", alignItems: "center", gap: 3 },
  paceText: { fontSize: 12.5, fontWeight: "800", includeFontPadding: false },
  paceMeta: { color: "#7e93ac", fontSize: 10.5, fontWeight: "600", flexShrink: 1 },
  actionBtn: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(52,211,153,0.14)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.35)",
  },
  actionBtnDone: { backgroundColor: "#34d399", borderColor: "#34d399" },
  closeBtn: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },

  chartRow: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  chartBars: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: CHART_HEIGHT,
    gap: 1.5,
  },
  bar: { flex: 1, borderRadius: 1.5, opacity: 0.85, minWidth: 2 },
  chartLabel: { color: "#5b6b80", fontSize: 9.5, fontWeight: "700" },
  noChartText: { color: "#5b6b80", fontSize: 11, fontWeight: "600" },
});
