import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { formatDay, formatTime, scheduleEndMs } from "@events/planner";
import { usePlanStore } from "./plan-store";
import type { MedicPlan, PlanCourse } from "./plan-model";

/**
 * Replay rate. A race day is measured in hours, so the useful speed is "an hour
 * in a few seconds" — 600× walks a 12-hour deployment past in about 70s.
 */
const REPLAY_SPEED = 600;

const LANE_HEIGHT = 26;
const LANE_GAP = 5;
/** Lanes shown before the list starts scrolling, collapsed and expanded. */
const LANES_COLLAPSED = 3;
const LANES_EXPANDED = 7;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * The deployment transport, docked over the bottom of the map.
 *
 * Deliberately not a bottom sheet, for the same reason the location-history
 * replay isn't one: the timeline drives what the map is showing, so it has to
 * sit beside the map rather than cover it.
 */
export function PlanTimeline({
  courses,
  medicPlans,
  span,
  cursorMs,
  live,
  bottomInset,
  onHeightChange,
}: {
  courses: PlanCourse[];
  medicPlans: MedicPlan[];
  span: { fromMs: number; toMs: number };
  cursorMs: number;
  live: boolean;
  bottomInset: number;
  /** Reports the card's rendered height, so anything docked above it can clear it. */
  onHeightChange?: (height: number) => void;
}) {
  const setCursor = usePlanStore((s) => s.setCursor);
  const selectedMedicId = usePlanStore((s) => s.selectedMedicId);
  const selectMedic = usePlanStore((s) => s.selectMedic);

  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const trackRef = useRef<View>(null);
  const trackPageX = useRef(0);

  const spanMs = Math.max(1, span.toMs - span.fromMs);
  const progress = clamp01((cursorMs - span.fromMs) / spanMs);

  // Playback. A per-frame tick is the kind of thing the app's battery rules
  // forbid for background work; this one only runs while somebody is watching
  // it, stops itself at the end of the window, and dies with the screen.
  const cursorRef = useRef(cursorMs);
  cursorRef.current = cursorMs;

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = Date.now();
    const step = () => {
      const now = Date.now();
      const next = cursorRef.current + (now - previous) * REPLAY_SPEED;
      previous = now;
      if (next >= span.toMs) {
        setCursor(span.toMs);
        setPlaying(false);
        return;
      }
      setCursor(next);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, span.toMs, setCursor]);

  /**
   * Seek from an ABSOLUTE screen x — `nativeEvent.locationX` restarts at each
   * child's own origin, so dragging across a lane label would jump the cursor.
   */
  const seekToPageX = useCallback(
    (pageX: number) => {
      if (trackWidth <= 0) return;
      setCursor(span.fromMs + clamp01((pageX - trackPageX.current) / trackWidth) * spanMs);
    },
    [trackWidth, span.fromMs, spanMs, setCursor],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Not a capture on START: the lanes are tappable, and capturing would
        // swallow every press before the medic rows ever saw it. A tap that no
        // child wants still lands here and seeks.
        onStartShouldSetPanResponder: () => true,
        // A horizontal DRAG is always a scrub, wherever it began — captured so
        // it can take the gesture off a lane press or the lane list's scroll.
        onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 4,
        onPanResponderGrant: (_e, g) => {
          setPlaying(false);
          void Haptics.selectionAsync();
          seekToPageX(g.x0);
        },
        onPanResponderMove: (_e, g) => seekToPageX(g.moveX),
      }),
    [seekToPageX],
  );

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
    trackRef.current?.measureInWindow((x) => {
      if (Number.isFinite(x)) trackPageX.current = x;
    });
  }, []);

  const x = (ms: number) => clamp01((ms - span.fromMs) / spanMs);

  /** Course bars: gun to cut-off, so the shift reads against the race, not the clock. */
  const courseBars = useMemo(
    () =>
      courses
        .filter((c) => c.enabled && Number.isFinite(new Date(c.schedule.startAt).getTime()))
        .map((c) => {
          const from = new Date(c.schedule.startAt).getTime();
          return { id: c.id, label: c.label, color: c.color, from: x(from), to: x(scheduleEndMs(c.schedule)) };
        }),
    [courses, span.fromMs, spanMs],
  );

  const laneHeight = (expanded ? LANES_EXPANDED : LANES_COLLAPSED) * (LANE_HEIGHT + LANE_GAP);
  const visibleLanes = Math.min(medicPlans.length, expanded ? LANES_EXPANDED : LANES_COLLAPSED);

  return (
    <View style={[styles.wrap, { bottom: bottomInset + 10 }]} pointerEvents="box-none">
      <View
        style={styles.card}
        onLayout={(e) => onHeightChange?.(e.nativeEvent.layout.height)}
      >
        {/* Clock + transport */}
        <View style={styles.header}>
          <Pressable
            style={styles.clockBlock}
            onPress={() => {
              setPlaying(false);
              setCursor(null);
            }}
          >
            <Text style={styles.clock}>{formatTime(cursorMs)}</Text>
            <Text style={styles.day}>{formatDay(cursorMs)}</Text>
          </Pressable>

          {live ? (
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>NOW</Text>
            </View>
          ) : (
            <Pressable
              style={styles.backToNow}
              onPress={() => {
                setPlaying(false);
                setCursor(null);
              }}
            >
              <Feather name="corner-up-left" size={12} color="#93c5fd" />
              <Text style={styles.backToNowText}>Now</Text>
            </Pressable>
          )}

          <View style={{ flex: 1 }} />

          <Pressable style={styles.iconBtn} onPress={() => setPlaying((v) => !v)}>
            <Feather name={playing ? "pause" : "play"} size={16} color="#e2e8f0" />
          </Pressable>
          <Pressable style={styles.iconBtn} onPress={() => setExpanded((v) => !v)}>
            <Feather name={expanded ? "chevron-down" : "chevron-up"} size={16} color="#e2e8f0" />
          </Pressable>
        </View>

        {/* The scrub surface: course bars, medic lanes and the playhead all share
            one x axis, so the whole block is the thing you drag. */}
        <View ref={trackRef} style={styles.track} onLayout={onTrackLayout} {...panResponder.panHandlers}>
          <View style={styles.courseRow}>
            {courseBars.map((bar) => (
              <View
                key={bar.id}
                style={[
                  styles.courseBar,
                  {
                    left: `${bar.from * 100}%`,
                    width: `${Math.max(0.5, (bar.to - bar.from) * 100)}%`,
                    backgroundColor: `${bar.color}55`,
                    borderColor: `${bar.color}aa`,
                  },
                ]}
              >
                <Text style={styles.courseBarText} numberOfLines={1}>
                  {bar.label}
                </Text>
              </View>
            ))}
          </View>

          <ScrollView
            style={{ height: laneHeight }}
            scrollEnabled={medicPlans.length > visibleLanes}
            // The scrub gesture owns this area; scrolling is a deliberate
            // two-finger-ish afterthought, so it must not steal the drag.
            scrollEventThrottle={32}
          >
            {medicPlans.map(({ medic, timeline }) => {
              const selected = selectedMedicId === medic.id;
              return (
                <Pressable
                  key={medic.id}
                  style={[styles.lane, selected && styles.laneSelected]}
                  onPress={() => selectMedic(selected ? null : medic.id)}
                >
                  <View style={[styles.laneChip, { backgroundColor: medic.color }]}>
                    <Text style={styles.laneChipText} numberOfLines={1}>
                      {medic.name.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.laneTrack}>
                    {timeline.segments.map((segment, i) => {
                      const from = x(segment.fromMs);
                      const to = x(Number.isFinite(segment.toMs) ? segment.toMs : span.toMs);
                      const width = Math.max(0.4, (to - from) * 100);
                      const isMove = segment.kind === "move";
                      const isSweep = segment.kind === "sweep";
                      return (
                        <View
                          key={`${segment.stationId}-${i}`}
                          style={[
                            styles.segment,
                            {
                              left: `${from * 100}%`,
                              width: `${width}%`,
                              backgroundColor: isMove
                                ? segment.tight
                                  ? "#ef4444"
                                  : "#f59e0b"
                                : isSweep
                                  ? `${segment.color ?? medic.color}cc`
                                  : `${medic.color}55`,
                              borderColor: isSweep ? "#e2e8f0" : "transparent",
                              borderWidth: isSweep ? 1 : 0,
                            },
                          ]}
                        />
                      );
                    })}
                  </View>
                </Pressable>
              );
            })}
            {medicPlans.length === 0 ? (
              <Text style={styles.emptyLanes}>No medics on the plan yet.</Text>
            ) : null}
          </ScrollView>

          {/* Playhead, drawn last so it sits over every lane. */}
          <View pointerEvents="none" style={[styles.playhead, { left: `${progress * 100}%` }]} />
        </View>

        <View style={styles.axis}>
          <Text style={styles.axisText}>{formatTime(span.fromMs)}</Text>
          <Text style={styles.axisText}>{formatTime(span.toMs)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 10, right: 10, zIndex: 40 },
  card: {
    backgroundColor: "rgba(8, 15, 28, 0.96)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.18)",
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 8 },
  clockBlock: { alignItems: "flex-start" },
  clock: { color: "#f8fafc", fontSize: 22, fontWeight: "800", letterSpacing: 0.5, lineHeight: 24 },
  day: { color: "#64748b", fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(16,185,129,0.14)",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#34d399" },
  liveText: { color: "#34d399", fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  backToNow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(59,130,246,0.14)",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  backToNowText: { color: "#93c5fd", fontSize: 10, fontWeight: "900", letterSpacing: 0.6 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  track: { position: "relative" },
  courseRow: { height: 16, marginBottom: 6, position: "relative" },
  courseBar: {
    position: "absolute",
    top: 0,
    height: 16,
    borderRadius: 5,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 5,
    overflow: "hidden",
  },
  courseBarText: { color: "#f1f5f9", fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },
  lane: { flexDirection: "row", alignItems: "center", gap: 6, height: LANE_HEIGHT, marginBottom: LANE_GAP },
  laneSelected: { backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 8 },
  laneChip: { width: 26, height: 18, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  laneChipText: { color: "#04121f", fontSize: 9, fontWeight: "900" },
  laneTrack: {
    flex: 1,
    height: 14,
    borderRadius: 7,
    backgroundColor: "rgba(148,163,184,0.10)",
    position: "relative",
    overflow: "hidden",
  },
  segment: { position: "absolute", top: 0, bottom: 0, borderRadius: 4 },
  emptyLanes: { color: "#64748b", fontSize: 12, fontWeight: "600", paddingVertical: 10, textAlign: "center" },
  playhead: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: "#f8fafc",
    shadowColor: "#fff",
    shadowOpacity: 0.7,
    shadowRadius: 4,
  },
  axis: { flexDirection: "row", justifyContent: "space-between", paddingTop: 5 },
  axisText: { color: "#475569", fontSize: 9, fontWeight: "700" },
});
