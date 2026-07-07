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
 * Full track-following overlay: next-turn card (top), whole-track progress bar
 * with elevation strip + controls (bottom), off-track and loop-skip feedback.
 */
export function TrackNavOverlay() {
  const phase = useTrackNavStore((s) => s.phase);
  const track = useTrackNavStore((s) => s.track);
  const prepared = useTrackNavStore((s) => s.prepared);
  const progress = useTrackNavStore((s) => s.progress);
  const arrived = useTrackNavStore((s) => s.arrived);
  const loopSkip = useTrackNavStore((s) => s.loopSkip);
  const muted = useTrackNavStore((s) => s.muted);
  const elevations = useTrackNavStore((s) => s.elevations);
  const stop = useTrackNavStore((s) => s.stop);
  const pause = useTrackNavStore((s) => s.pause);
  const resume = useTrackNavStore((s) => s.resume);
  const toggleMuted = useTrackNavStore((s) => s.toggleMuted);
  const dismissLoopSkip = useTrackNavStore((s) => s.dismissLoopSkip);

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

  // Loop-skip toast auto-dismiss.
  useEffect(() => {
    if (!loopSkip) return;
    const timer = setTimeout(dismissLoopSkip, LOOP_TOAST_MS);
    return () => clearTimeout(timer);
  }, [loopSkip, dismissLoopSkip]);

  const elevationBars = useMemo(() => buildElevationBars(elevations), [elevations]);

  if (phase === "idle" || !prepared || !track) return null;

  const instruction = prepared.instructions[progress?.instructionIndex ?? 0];
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
      {/* Next-turn card. */}
      <View style={styles.turnCard}>
        <View style={styles.turnRow}>
          <View style={[styles.arrowBadge, arrived && styles.arrowBadgeArrived]}>
            <Text style={styles.arrowGlyph}>{arrived ? "◎" : maneuverGlyph(maneuver)}</Text>
          </View>
          <View style={styles.turnTextWrap}>
            <Text style={styles.turnDistance}>{progress ? formatDistance(toManeuver) : "—"}</Text>
            <Text style={styles.turnLabel} numberOfLines={1}>
              {arrived ? "Track complete" : maneuverLabel(maneuver)}
            </Text>
          </View>
        </View>
        <View style={styles.maneuverTrack}>
          <View style={[styles.maneuverFill, { width: `${barFill * 100}%` }]} />
        </View>
        {progress?.offTrack ? <OffTrackPill meters={progress.offTrackMeters} /> : null}
        {paused ? (
          <View style={styles.pausedPill}>
            <Feather name="pause" size={12} color="#dbe7f5" />
            <Text style={styles.pausedText}>Guidance paused</Text>
          </View>
        ) : null}
      </View>

      {/* Loop-skip toast. */}
      {loopSkip ? <LoopSkipToast jumpMeters={loopSkip.jumpMeters} /> : null}

      {/* Bottom panel: elevation strip + whole-track progress + controls. */}
      <View style={styles.bottomPanel}>
        <View style={styles.trackTitleRow}>
          <View style={[styles.trackDot, { backgroundColor: track.color ?? "#34d399" }]} />
          <Text style={styles.trackTitle} numberOfLines={1}>
            {track.label}
          </Text>
          <Text style={styles.trackPercent}>{percent}%</Text>
        </View>

        {elevationBars ? (
          <View style={styles.elevationRow}>
            {elevationBars.map((h, i) => (
              <View
                key={i}
                style={[
                  styles.elevationBar,
                  {
                    height: 4 + h * 22,
                    backgroundColor: i <= positionIndex ? (track.color ?? "#34d399") : "rgba(148,163,184,0.28)",
                  },
                ]}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                backgroundColor: track.color ?? "#34d399",
                width: fillAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
              },
            ]}
          />
        </View>

        <View style={styles.statsRow}>
          <Text style={styles.statsDone}>
            {doneKm} <Text style={styles.statsMuted}>/ {totalKm} km</Text>
          </Text>
          <Text style={styles.statsRemaining}>
            {progress ? formatDistance(progress.remainingMeters) : "—"} left
            {progress?.speedMps != null ? `  ·  ${(progress.speedMps * 3.6).toFixed(1)} km/h` : ""}
          </Text>
        </View>

        <View style={styles.controlsRow}>
          <Pressable
            style={({ pressed }) => [styles.controlBtn, pressed && styles.controlBtnPressed]}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              toggleMuted();
            }}
            hitSlop={6}
          >
            <Feather name={muted ? "volume-x" : "volume-2"} size={17} color={muted ? "#f5b301" : "#9fb3cc"} />
            <Text style={[styles.controlText, muted && { color: "#f5b301" }]}>{muted ? "Muted" : "Voice"}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.controlBtn, pressed && styles.controlBtnPressed]}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (paused) resume();
              else pause();
            }}
            hitSlop={6}
          >
            <Feather name={paused ? "play" : "pause"} size={17} color="#9fb3cc" />
            <Text style={styles.controlText}>{paused ? "Resume" : "Pause"}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.controlBtn, styles.stopBtn, pressed && styles.stopBtnPressed]}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              stop();
            }}
            hitSlop={6}
          >
            <View style={styles.stopIcon} />
            <Text style={styles.stopText}>End</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Flashing gold pill while off the track, with the distance back to it. */
function OffTrackPill({ meters }: { meters: number }) {
  const flash = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flash, { toValue: 0.4, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(flash, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [flash]);

  return (
    <Animated.View style={[styles.offTrackPill, { opacity: flash }]}>
      <Feather name="corner-up-left" size={12} color="#1a1206" />
      <Text style={styles.offTrackText}>Off track · {formatDistance(meters)} back to route</Text>
    </Animated.View>
  );
}

/** Slide-in confirmation after an auto-detected loop skip. */
function LoopSkipToast({ jumpMeters }: { jumpMeters: number }) {
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
      <Feather name="fast-forward" size={14} color="#04140E" />
      <Text style={styles.loopToastText}>Loop skipped — {formatDistance(jumpMeters)} ahead</Text>
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
  turnCard: {
    position: "absolute",
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
  arrowBadgeArrived: { backgroundColor: "#34d399", shadowColor: "#34d399" },
  arrowGlyph: { color: "#1a1206", fontSize: 30, fontWeight: "900", lineHeight: 34 },
  turnTextWrap: { flex: 1 },
  turnDistance: { color: "#FFFFFF", fontSize: 27, fontWeight: "900", letterSpacing: 0.3, lineHeight: 30 },
  turnLabel: { color: "#9fb3cc", fontSize: 13, fontWeight: "800", marginTop: 1 },
  maneuverTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(148,163,184,0.18)",
    marginTop: 10,
    overflow: "hidden",
  },
  maneuverFill: { height: 4, borderRadius: 2, backgroundColor: "#f5b301" },
  offTrackPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 9,
    alignSelf: "flex-start",
    backgroundColor: "#f5b301",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    shadowColor: "#f5b301",
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  offTrackText: { color: "#1a1206", fontSize: 12, fontWeight: "900", letterSpacing: 0.2 },
  pausedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 9,
    alignSelf: "flex-start",
    backgroundColor: "rgba(148,163,184,0.2)",
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  pausedText: { color: "#dbe7f5", fontSize: 12, fontWeight: "800" },
  loopToast: {
    position: "absolute",
    bottom: 196,
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
  bottomPanel: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: "rgba(9,14,24,0.96)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 16,
  },
  trackTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  trackDot: { width: 8, height: 8, borderRadius: 4 },
  trackTitle: { flex: 1, color: "#dbe7f5", fontSize: 13, fontWeight: "800" },
  trackPercent: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  elevationRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    height: 28,
    marginTop: 10,
  },
  elevationBar: { flex: 1, borderRadius: 1.5 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(148,163,184,0.18)",
    marginTop: 8,
    overflow: "hidden",
  },
  progressFill: { height: 6, borderRadius: 3 },
  statsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  statsDone: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  statsMuted: { color: "#64748b", fontSize: 13, fontWeight: "800" },
  statsRemaining: { color: "#9fb3cc", fontSize: 12.5, fontWeight: "700" },
  controlsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  controlBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 11,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
  },
  controlBtnPressed: { backgroundColor: "rgba(255,255,255,0.12)" },
  controlText: { color: "#9fb3cc", fontSize: 13, fontWeight: "800" },
  stopBtn: { backgroundColor: "#ef4444", borderColor: "rgba(255,255,255,0.18)" },
  stopBtnPressed: { backgroundColor: "#dc2626" },
  stopIcon: { width: 11, height: 11, borderRadius: 3, backgroundColor: "#fff" },
  stopText: { color: "#fff", fontSize: 13.5, fontWeight: "900", letterSpacing: 0.3 },
});
