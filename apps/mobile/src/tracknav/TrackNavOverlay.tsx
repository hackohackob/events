import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { formatDistance } from "../navigation/geo";
import { maneuverGlyph, maneuverLabel } from "../navigation/surface";
import { useTrackNavStore } from "./track-nav-store";

/** Reference distance over which the maneuver progress bar fills (metres). */
const MANEUVER_BAR_REFERENCE_M = 400;
const ELEVATION_BARS = 44;
const LOOP_TOAST_MS = 4_500;

/**
 * Track-following HUD — the same visual language as point-to-point navigation
 * (maneuver banner, floating speed puck + controls, bottom dock), plus the
 * track-specific extras: the elevation strip painted up to the current
 * position, done/total km, distance left and % completed.
 */
export function TrackNavOverlay() {
  const phase = useTrackNavStore((s) => s.phase);
  const track = useTrackNavStore((s) => s.track);
  const prepared = useTrackNavStore((s) => s.prepared);
  const progress = useTrackNavStore((s) => s.progress);
  const arrived = useTrackNavStore((s) => s.arrived);
  const loopSkip = useTrackNavStore((s) => s.loopSkip);
  const legSwitch = useTrackNavStore((s) => s.legSwitch);
  const muted = useTrackNavStore((s) => s.muted);
  const elevations = useTrackNavStore((s) => s.elevations);
  const stop = useTrackNavStore((s) => s.stop);
  const pause = useTrackNavStore((s) => s.pause);
  const resume = useTrackNavStore((s) => s.resume);
  const toggleMuted = useTrackNavStore((s) => s.toggleMuted);
  const dismissLoopSkip = useTrackNavStore((s) => s.dismissLoopSkip);
  const dismissLegSwitch = useTrackNavStore((s) => s.dismissLegSwitch);

  // Animated whole-track progress fill.
  const fillAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!progress) return;
    Animated.timing(fillAnim, {
      toValue: Math.max(0.01, Math.min(1, progress.fraction)),
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // width animation
    }).start();
  }, [progress, fillAnim]);

  // Loop-skip / direction-correction toast auto-dismiss.
  useEffect(() => {
    if (!loopSkip) return;
    const timer = setTimeout(dismissLoopSkip, LOOP_TOAST_MS);
    return () => clearTimeout(timer);
  }, [loopSkip, dismissLoopSkip]);
  useEffect(() => {
    if (!legSwitch) return;
    const timer = setTimeout(dismissLegSwitch, LOOP_TOAST_MS);
    return () => clearTimeout(timer);
  }, [legSwitch, dismissLegSwitch]);

  const elevationBars = useMemo(() => buildElevationBars(elevations), [elevations]);

  if (phase === "idle" || !prepared || !track) return null;

  const accent = track.color ?? "#34d399";
  const instruction = prepared.instructions[progress?.instructionIndex ?? 0];
  const nextInstruction = prepared.instructions[(progress?.instructionIndex ?? 0) + 1];
  const maneuver = instruction?.maneuver ?? "continue";
  const toManeuver = progress?.toManeuverMeters ?? 0;
  const barFill = Math.max(0.04, Math.min(1, 1 - toManeuver / MANEUVER_BAR_REFERENCE_M));
  const paused = phase === "paused";
  const doneKm = ((progress?.alongMeters ?? 0) / 1000).toFixed(1);
  const totalKm = (prepared.totalMeters / 1000).toFixed(1);
  const percent = Math.round((progress?.fraction ?? 0) * 100);
  const positionIndex = progress
    ? Math.min(ELEVATION_BARS - 1, Math.floor(progress.fraction * ELEVATION_BARS))
    : 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* ── Maneuver banner ── */}
      <View style={[styles.banner, arrived && styles.bannerArrive]}>
        <View style={styles.bannerRow}>
          <View style={[styles.arrowBadge, arrived && styles.arrowBadgeArrive]}>
            <Text style={styles.arrowGlyph} allowFontScaling={false}>
              {arrived ? "◎" : maneuverGlyph(maneuver)}
            </Text>
          </View>
          <View style={styles.bannerTextWrap}>
            <Text style={styles.bannerDistance} allowFontScaling={false}>
              {arrived ? "Done" : progress ? formatDistance(toManeuver) : "—"}
            </Text>
            <Text style={styles.bannerLabel} numberOfLines={1}>
              {arrived ? "Track complete" : `${maneuverLabel(maneuver)} · ${track.label}`}
            </Text>
          </View>
          {nextInstruction && !arrived ? (
            <View style={styles.thenChip}>
              <Text style={styles.thenChipCaption}>then</Text>
              <Text style={styles.thenChipGlyph} allowFontScaling={false}>
                {maneuverGlyph(nextInstruction.maneuver)}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.maneuverTrack}>
          <View style={[styles.maneuverFill, arrived && styles.maneuverFillArrive, { width: `${barFill * 100}%` }]} />
        </View>
      </View>

      {/* Off-track / paused strip, right under the banner. */}
      {progress?.offTrack && !paused ? <OffTrackStrip meters={progress.offTrackMeters} /> : null}
      {paused ? (
        <View style={styles.pausedStrip}>
          <Feather name="pause" size={13} color="#dbe7f5" />
          <Text style={styles.pausedText}>Guidance paused</Text>
        </View>
      ) : null}

      {/* Loop-skip / direction-correction toasts. */}
      {loopSkip ? <JumpToast icon="fast-forward" text={`Loop skipped — ${formatDistance(loopSkip.jumpMeters)} ahead`} /> : null}
      {!loopSkip && legSwitch ? <JumpToast icon="repeat" text="Direction corrected — following your leg" /> : null}

      {/* ── Bottom: speed puck + pause/voice floating above the dock ── */}
      <View style={styles.bottomStack} pointerEvents="box-none">
        <View style={styles.floatRow} pointerEvents="box-none">
          <SpeedPuck speedMps={progress?.speedMps ?? null} accent={accent} />
          <View style={styles.floatButtons}>
            <Pressable
              style={styles.floatBtn}
              onPress={() => {
                void Haptics.selectionAsync();
                if (paused) resume();
                else pause();
              }}
              hitSlop={8}
            >
              <Feather name={paused ? "play" : "pause"} size={18} color={paused ? "#34d399" : "#cfe0f4"} />
            </Pressable>
            <Pressable
              style={styles.floatBtn}
              onPress={() => {
                void Haptics.selectionAsync();
                toggleMuted();
              }}
              hitSlop={8}
            >
              <Feather name={muted ? "volume-x" : "volume-2"} size={18} color={muted ? "#f5b301" : "#cfe0f4"} />
            </Pressable>
          </View>
        </View>

        {/* ── Dock ── */}
        <View style={styles.dock}>
          {/* Elevation strip, painted up to the current position. */}
          {elevationBars ? (
            <View style={styles.elevationRow}>
              {elevationBars.map((h, i) => (
                <View
                  key={i}
                  style={[
                    styles.elevationBar,
                    {
                      height: 3 + h * 20,
                      backgroundColor: i <= positionIndex ? accent : "rgba(148,163,184,0.24)",
                    },
                  ]}
                />
              ))}
            </View>
          ) : null}

          {/* Whole-track progress. */}
          <View style={styles.routeTrack}>
            <Animated.View
              style={[
                styles.routeFill,
                {
                  backgroundColor: accent,
                  width: fillAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
                },
              ]}
            />
          </View>

          <View style={styles.dockRow}>
            <View style={styles.dockStats}>
              <View style={styles.statGroup}>
                <Text style={styles.heroValue} allowFontScaling={false}>
                  <Text style={{ color: accent }}>{doneKm}</Text>
                  <Text style={styles.heroMuted}> / {totalKm} km</Text>
                </Text>
                <Text style={styles.statCaption}>done</Text>
              </View>
              <View style={styles.dockDivider} />
              <View style={styles.statGroup}>
                <Text style={styles.statValue} allowFontScaling={false}>
                  {progress ? formatDistance(progress.remainingMeters) : "—"}
                </Text>
                <Text style={styles.statCaption}>left</Text>
              </View>
              <View style={styles.dockDivider} />
              <View style={styles.statGroup}>
                <Text style={styles.statValue} allowFontScaling={false}>{percent}%</Text>
                <Text style={styles.statCaption}>completed</Text>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [styles.endBtn, pressed && styles.endBtnPressed]}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                stop();
              }}
              hitSlop={6}
            >
              <View style={styles.endStopIcon} />
              <Text style={styles.endText}>End</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

/** Current speed in a floating circular puck, ringed in the track colour. */
function SpeedPuck({ speedMps, accent }: { speedMps: number | null; accent: string }) {
  const kmh = speedMps != null && speedMps > 0.4 ? Math.round(speedMps * 3.6) : 0;
  return (
    <View style={[styles.speedPuck, { borderColor: accent }]}>
      <Text style={styles.speedValue} allowFontScaling={false}>{kmh}</Text>
      <Text style={styles.speedUnit} allowFontScaling={false}>km/h</Text>
    </View>
  );
}

/** Flashing amber strip while off the track, with the distance back to it. */
function OffTrackStrip({ meters }: { meters: number }) {
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
    <Animated.View style={[styles.offTrackStrip, { opacity: flash }]}>
      <Feather name="corner-up-left" size={13} color="#1a1206" />
      <Text style={styles.offTrackText}>Off track · {formatDistance(meters)} back to route</Text>
    </Animated.View>
  );
}

/** Slide-in confirmation after an auto-detected progress jump (loop skip or
 *  out-and-back direction correction). */
function JumpToast({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: 1, useNativeDriver: true, damping: 14, stiffness: 160 }).start();
  }, [slide]);

  return (
    <Animated.View
      style={[
        styles.loopToast,
        {
          opacity: slide,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        },
      ]}
    >
      <Feather name={icon} size={14} color="#04140E" />
      <Text style={styles.loopToastText}>{text}</Text>
    </Animated.View>
  );
}

/** Normalize the GPX elevations into N bar heights (0–1). Null without <ele>. */
function buildElevationBars(elevations: Array<number | undefined>): number[] | null {
  const known = elevations.filter((e): e is number => Number.isFinite(e));
  if (known.length < 2) return null;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = Math.max(1, max - min);
  const bars: number[] = [];
  for (let i = 0; i < ELEVATION_BARS; i += 1) {
    const idx = Math.min(elevations.length - 1, Math.floor((i / (ELEVATION_BARS - 1)) * (elevations.length - 1)));
    // Nearest known elevation around the sample index.
    let ele = elevations[idx];
    for (let step = 1; ele === undefined && step < elevations.length; step += 1) {
      ele = elevations[idx - step] ?? elevations[idx + step];
    }
    bars.push(((ele ?? min) - min) / span);
  }
  return bars;
}

const styles = StyleSheet.create({
  // ── Maneuver banner (mirrors ActiveNavOverlay) ──
  banner: {
    position: "absolute",
    top: 66,
    left: 12,
    // Clear of the right-hand map controls column.
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
    width: 54,
    height: 54,
    borderRadius: 16,
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
  arrowGlyph: { color: "#1a1206", fontSize: 34, fontWeight: "900", lineHeight: 40 },
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

  // ── Strips under the banner ──
  offTrackStrip: {
    position: "absolute",
    top: 152,
    left: 26,
    right: 84,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#f5b301",
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 14,
    shadowColor: "#f5b301",
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
  offTrackText: { color: "#1a1206", fontSize: 12.5, fontWeight: "900", letterSpacing: 0.2 },
  pausedStrip: {
    position: "absolute",
    top: 152,
    left: 26,
    right: 84,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "rgba(30, 41, 59, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.3)",
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  pausedText: { color: "#dbe7f5", fontSize: 12.5, fontWeight: "800" },
  loopToast: {
    position: "absolute",
    bottom: 210,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#34d399",
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 16,
    shadowColor: "#34d399",
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
  loopToastText: { color: "#04140E", fontSize: 13.5, fontWeight: "900", letterSpacing: 0.2 },

  // ── Bottom stack ──
  bottomStack: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 10,
    gap: 10,
  },
  floatRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 2,
  },
  floatButtons: { flexDirection: "row", gap: 9 },
  floatBtn: {
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
  elevationRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    height: 26,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  elevationBar: { flex: 1, borderRadius: 1.5 },
  routeTrack: { height: 3.5, backgroundColor: "rgba(148,163,184,0.14)", marginTop: 7 },
  routeFill: { height: 3.5 },
  dockRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  dockStats: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  statGroup: { alignItems: "flex-start" },
  heroValue: { fontSize: 21, fontWeight: "900", lineHeight: 24 },
  heroMuted: { color: "#64748b", fontSize: 14, fontWeight: "800" },
  statValue: { color: "#eef4fb", fontSize: 16.5, fontWeight: "900", lineHeight: 20 },
  statCaption: { color: "#4d6076", fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  dockDivider: { width: 1, height: 26, backgroundColor: "rgba(148,163,184,0.16)" },
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
});
