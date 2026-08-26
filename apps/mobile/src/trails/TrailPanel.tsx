import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { trailColor } from "@events/contracts";
import { TRAIL_WINDOWS, useTrailStore, type TrailWindow } from "./trail-store";
import { formatClock, formatDistance, formatDuration, formatSpeed } from "./trail-geometry";

/** Replay rate. One value, not a picker — on a phone the choice is noise, and
 *  240× walks a 12h window past in three minutes. */
const REPLAY_SPEED = 240;

/** Samples further apart than this are an outage, and break the coverage bar. */
const COVERAGE_GAP_MS = 8 * 60_000;

/**
 * The location-history transport, docked over the bottom of the map.
 *
 * Deliberately NOT a bottom sheet: a replay is something you watch happen on
 * the map, so the control has to sit beside the thing it drives rather than
 * cover it. It also keeps this feature entirely out of the existing selection
 * sheet's state machine.
 */
export function TrailPanel({ bottomInset }: { bottomInset: number }) {
  const target = useTrailStore((s) => s.target);
  const trail = useTrailStore((s) => s.trail);
  const activeWindow = useTrailStore((s) => s.window);
  const loading = useTrailStore((s) => s.loading);
  const error = useTrailStore((s) => s.error);
  const cursorMs = useTrailStore((s) => s.cursorMs);
  const setCursor = useTrailStore((s) => s.setCursor);
  const setWindow = useTrailStore((s) => s.setWindow);
  const close = useTrailStore((s) => s.close);

  const [playing, setPlaying] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const trackRef = useRef<View>(null);
  const trackPageX = useRef(0);

  // The replay clock. Anchored to the trail's own window so the timeline can't
  // stretch under the playhead as the live trail grows.
  const fromMs = useMemo(() => (trail ? new Date(trail.from).getTime() : 0), [trail]);
  const toMs = useMemo(() => (trail ? new Date(trail.to).getTime() : 1), [trail]);
  const spanMs = Math.max(1, toMs - fromMs);
  const effectiveCursor = cursorMs ?? toMs;
  const progress = clamp01((effectiveCursor - fromMs) / spanMs);

  // Playback. A per-frame tick is exactly the kind of thing the app's battery
  // rules forbid for background work — this one is allowed because it only
  // runs while the user is holding the screen watching it, stops itself at the
  // end of the window, and is torn down the moment the panel closes.
  const cursorRef = useRef(effectiveCursor);
  cursorRef.current = effectiveCursor;

  useEffect(() => {
    if (!playing || !trail) return;
    let frame = 0;
    let previous = Date.now();

    const step = () => {
      const now = Date.now();
      const next = cursorRef.current + (now - previous) * REPLAY_SPEED;
      previous = now;
      if (next >= toMs) {
        setCursor(toMs);
        setPlaying(false);
        return;
      }
      setCursor(next);
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, trail, toMs, setCursor]);

  // Closing the panel must never leave a frame loop running.
  useEffect(() => {
    if (!target) setPlaying(false);
  }, [target]);

  /**
   * Seek from an ABSOLUTE screen x.
   *
   * Deliberately not `nativeEvent.locationX`: that is measured from whichever
   * element the touch is currently over, not from the track. Dragging across
   * the shade overlay or the clock labels therefore restarted x at that child's
   * own origin, and the cursor jumped to the left mid-scrub. `pageX` is the one
   * coordinate that stays in a single frame of reference for the whole drag.
   */
  const seekToPageX = useCallback(
    (pageX: number) => {
      if (trackWidth <= 0) return;
      setCursor(fromMs + clamp01((pageX - trackPageX.current) / trackWidth) * spanMs);
    },
    [trackWidth, fromMs, spanMs, setCursor],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Capture so the gesture belongs to the scrubber, not to the map
        // underneath or any scroll container above it.
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        // gestureState x0/moveX are page coordinates, unlike nativeEvent.locationX.
        onPanResponderGrant: (_e, g) => {
          setPlaying(false);
          void Haptics.selectionAsync();
          seekToPageX(g.x0);
        },
        onPanResponderMove: (_e, g) => seekToPageX(g.moveX),
      }),
    [seekToPageX],
  );

  // The track's left edge in page coordinates. Re-measured on every layout so
  // it survives rotation and the panel resizing when the window changes.
  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
    trackRef.current?.measureInWindow((x) => {
      if (Number.isFinite(x)) trackPageX.current = x;
    });
  }, []);

  if (!target) return null;

  const color = trail ? trailColor(trail.medicId) : "#38bdf8";
  const isLive = cursorMs == null;

  return (
    <View style={[styles.wrap, { bottom: bottomInset + 12 }]} pointerEvents="box-none">
      <View style={styles.card}>
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>{target.name}</Text>
            <Text style={styles.subtitle}>
              {loading
                ? "Loading history…"
                : `${activeWindow === "event" ? "Whole event" : `Last ${activeWindow}h`}${trail ? ` · ${trail.rawCount.toLocaleString()} points` : ""}`}
            </Text>
          </View>
          {loading ? <ActivityIndicator size="small" color="#64748b" /> : null}
          <Pressable onPress={close} hitSlop={12} style={styles.iconButton} accessibilityLabel="Close location history">
            <Feather name="x" size={16} color="#94a3b8" />
          </Pressable>
        </View>

        {/* Window chips */}
        <View style={styles.chips}>
          {TRAIL_WINDOWS.map((option) => {
            const active = activeWindow === option;
            // "Event" is a different KIND of span, not a longer one, so it gets
            // its own accent and a little extra width for the word.
            const isArchive = option === "event";
            return (
              <Pressable
                key={String(option)}
                onPress={() => { void Haptics.selectionAsync(); setWindow(option as TrailWindow); }}
                style={[
                  styles.chip,
                  isArchive && styles.chipWide,
                  active && (isArchive ? styles.chipActiveArchive : styles.chipActive),
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    active && (isArchive ? styles.chipTextActiveArchive : styles.chipTextActive),
                  ]}
                >
                  {isArchive ? "Event" : `${option}h`}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Spell out what "Event" covers — otherwise a two-day archive just
            looks like a very long, undated timeline. */}
        {activeWindow === "event" && trail ? (
          <Text style={styles.archiveSpan}>
            {formatDay(trail.from)} → {formatDay(trail.to)}
          </Text>
        ) : null}

        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : trail && trail.rawCount === 0 ? (
          <Text style={styles.empty}>No positions recorded in this window.</Text>
        ) : trail ? (
          <>
            {/* Stats */}
            <View style={styles.stats}>
              <Stat icon="map" label="Covered" value={formatDistance(trail.stats.distanceMeters)} />
              <Stat icon="activity" label="Moving" value={formatDuration(trail.stats.movingMs)} />
              <Stat icon="anchor" label="Stops" value={String(trail.dwells.length)} />
              <Stat icon="trending-up" label="Avg" value={formatSpeed(trail.stats.avgMovingSpeed)} />
            </View>

            {/* Scrubber */}
            <View style={styles.transport}>
              <Pressable
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  if (playing) { setPlaying(false); return; }
                  // Pressing play at the end restarts instead of doing nothing.
                  if (cursorMs == null || cursorMs >= toMs - 1000) setCursor(fromMs);
                  setPlaying(true);
                }}
                style={styles.playButton}
                accessibilityLabel={playing ? "Pause replay" : "Play replay"}
              >
                <Feather name={playing ? "pause" : "play"} size={15} color="#04121f" />
              </Pressable>

              <View style={styles.trackColumn}>
                <View ref={trackRef} style={styles.track} onLayout={onTrackLayout} {...panResponder.panHandlers}>
                  <View style={styles.trackBase} pointerEvents="none" />
                  <CoverageBar trail={trail} fromMs={fromMs} spanMs={spanMs} color={color} />
                  {!isLive ? (
                    <View style={[styles.trackShade, { left: `${progress * 100}%` }]} pointerEvents="none" />
                  ) : null}
                  <View
                    style={[styles.playhead, { left: `${progress * 100}%`, backgroundColor: isLive ? "#22c55e" : "#e2e8f0" }]}
                    pointerEvents="none"
                  />
                </View>
                <View style={styles.trackLabels}>
                  <Text style={styles.trackLabel}>{formatEdge(fromMs, spanMs)}</Text>
                  <Text style={[styles.trackClock, { color: isLive ? "#22c55e" : "#e2e8f0" }]}>
                    {formatEdge(effectiveCursor, spanMs)}
                  </Text>
                  <Text style={styles.trackLabel}>{formatEdge(toMs, spanMs)}</Text>
                </View>
              </View>

              <Pressable
                onPress={() => { setPlaying(false); setCursor(null); }}
                disabled={isLive}
                style={[styles.liveButton, isLive && styles.liveButtonOff]}
                accessibilityLabel="Show the whole window"
              >
                <Text style={[styles.liveText, isLive && styles.liveTextOff]}>LIVE</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

/** When the medic was actually reporting — the gaps are the point. */
function CoverageBar({ trail, fromMs, spanMs, color }: {
  trail: NonNullable<ReturnType<typeof useTrailStore.getState>["trail"]>;
  fromMs: number;
  spanMs: number;
  color: string;
}) {
  const blocks = useMemo(() => {
    const t = trail.samples.t;
    const out: Array<{ left: number; width: number }> = [];
    if (t.length === 0) return out;
    let start = t[0];
    for (let i = 1; i <= t.length; i += 1) {
      if (i < t.length && t[i] - t[i - 1] <= COVERAGE_GAP_MS) continue;
      const end = t[i - 1];
      out.push({
        left: ((start - fromMs) / spanMs) * 100,
        // Floor the width so an isolated fix is still a visible pip.
        width: Math.max(0.6, ((end - start) / spanMs) * 100),
      });
      if (i < t.length) start = t[i];
    }
    return out;
  }, [trail, fromMs, spanMs]);

  return (
    <>
      {blocks.map((block, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[styles.coverage, { left: `${block.left}%`, width: `${block.width}%`, backgroundColor: color }]}
        />
      ))}
    </>
  );
}

function Stat({ icon, label, value }: { icon: keyof typeof Feather.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statLabelRow}>
        <Feather name={icon} size={9} color="#475569" />
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** ISO → "14 Aug". */
function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/** Across a multi-day archive a bare "06:00" is ambiguous, so the day is
 *  prefixed once the span crosses a calendar day. */
function formatEdge(ms: number, spanMs: number): string {
  if (spanMs <= 24 * 3_600_000) return formatClock(ms);
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth() + 1} ${formatClock(ms)}`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, zIndex: 30 },
  card: {
    backgroundColor: "rgba(10,18,34,0.96)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 14,
  },

  header: { flexDirection: "row", alignItems: "center", gap: 9 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: "#e2e8f0", fontSize: 15, fontWeight: "800" },
  subtitle: { color: "#475569", fontSize: 10.5, fontWeight: "700", marginTop: 1 },
  iconButton: {
    width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(148,163,184,0.12)",
  },

  chips: { flexDirection: "row", gap: 5, marginTop: 10, backgroundColor: "rgba(148,163,184,0.08)", borderRadius: 11, padding: 3 },
  chip: { flex: 1, paddingVertical: 5, borderRadius: 8, alignItems: "center" },
  chipWide: { flex: 1.4 },
  chipActive: { backgroundColor: "rgba(34,197,94,0.16)" },
  chipActiveArchive: { backgroundColor: "rgba(56,189,248,0.18)" },
  chipText: { color: "#64748b", fontSize: 11.5, fontWeight: "800" },
  chipTextActive: { color: "#4ade80" },
  chipTextActiveArchive: { color: "#7dd3fc" },
  archiveSpan: { color: "#7dd3fc", fontSize: 10.5, fontWeight: "800", marginTop: 6 },

  error: { color: "#fca5a5", fontSize: 11.5, fontWeight: "700", marginTop: 11, textAlign: "center" },
  empty: { color: "#64748b", fontSize: 11.5, fontWeight: "700", marginTop: 11, textAlign: "center" },

  stats: { flexDirection: "row", marginTop: 11, gap: 8 },
  stat: { flex: 1, minWidth: 0 },
  statLabelRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  statLabel: { color: "#475569", fontSize: 8.5, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  statValue: { color: "#e2e8f0", fontSize: 12.5, fontWeight: "800", marginTop: 2 },

  transport: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  playButton: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: "#22c55e",
    alignItems: "center", justifyContent: "center",
  },
  trackColumn: { flex: 1 },
  // Generous height so the whole strip is a comfortable drag target, with the
  // visible bar drawn thin inside it.
  track: { height: 26, justifyContent: "center" },
  trackBase: {
    position: "absolute", left: 0, right: 0, height: 5, borderRadius: 3,
    backgroundColor: "rgba(148,163,184,0.12)",
  },
  coverage: { position: "absolute", height: 5, borderRadius: 3, opacity: 0.9 },
  trackShade: { position: "absolute", right: 0, height: 5, borderRadius: 3, backgroundColor: "rgba(6,12,24,0.72)" },
  playhead: {
    position: "absolute", width: 3, height: 18, borderRadius: 2, marginLeft: -1.5,
  },
  trackLabels: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 1 },
  trackLabel: { color: "#475569", fontSize: 9, fontWeight: "700" },
  trackClock: { fontSize: 11, fontWeight: "900" },

  liveButton: {
    paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9,
    backgroundColor: "rgba(34,197,94,0.14)",
  },
  liveButtonOff: { opacity: 0.35 },
  liveText: { color: "#4ade80", fontSize: 9.5, fontWeight: "900", letterSpacing: 0.8 },
  liveTextOff: { color: "#4ade80" },
});
