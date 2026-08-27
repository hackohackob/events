import React, { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

/**
 * Touch diagnostics.
 *
 * Purely a measuring instrument — it changes nothing about how the app behaves,
 * and nothing outside this file imports it except the Debug screen's toggle.
 *
 * It exists because "the map won't pan on my phone" has three completely
 * different causes that look identical to the person holding it:
 *
 *  1. the finger's MOVE events never reach the app at all (a screen protector,
 *     a digitizer fault, or an accessibility / floating-overlay service eating
 *     them) — pad A shows downs and ups but no moves;
 *  2. they reach React Native but something above steals the gesture — pad A
 *     shows moves followed by a CANCEL;
 *  3. react-native-gesture-handler itself never activates — pad A is healthy
 *     while pad B never leaves "began".
 *
 * Two pads, six counters, one screenshot, and we know which one it is.
 */
export function TouchTestScreen({ onClose }: { onClose?: () => void }) {
  // Pad A — React Native's own responder system (what the map overlays, the
  // scrub surfaces and every Pressable in the app ride on).
  const [plain, setPlain] = useState({ down: 0, move: 0, up: 0, cancel: 0, maxPointers: 0, travel: 0 });
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const plainResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const { pageX, pageY, touches } = event.nativeEvent;
          lastPoint.current = { x: pageX, y: pageY };
          setPlain((s) => ({
            ...s,
            down: s.down + 1,
            maxPointers: Math.max(s.maxPointers, touches?.length ?? 1),
          }));
        },
        onPanResponderMove: (event) => {
          const { pageX, pageY, touches } = event.nativeEvent;
          const previous = lastPoint.current;
          const step = previous ? Math.hypot(pageX - previous.x, pageY - previous.y) : 0;
          lastPoint.current = { x: pageX, y: pageY };
          setPlain((s) => ({
            ...s,
            move: s.move + 1,
            travel: s.travel + step,
            maxPointers: Math.max(s.maxPointers, touches?.length ?? 1),
          }));
        },
        onPanResponderRelease: () => {
          lastPoint.current = null;
          setPlain((s) => ({ ...s, up: s.up + 1 }));
        },
        // The interesting one: a cancel means the touch DID arrive and was then
        // taken away by something higher up the tree.
        onPanResponderTerminate: () => {
          lastPoint.current = null;
          setPlain((s) => ({ ...s, cancel: s.cancel + 1 }));
        },
        // Never hand the gesture over voluntarily — anything that takes it has
        // to take it, which is exactly what we want to measure.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => false,
      }),
    [],
  );

  // Pad B — react-native-gesture-handler (what the bottom sheets drag on).
  const [gh, setGh] = useState({ began: 0, activated: 0, updates: 0, ended: 0, failed: 0 });
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onBegin(() => setGh((s) => ({ ...s, began: s.began + 1 })))
        .onStart(() => setGh((s) => ({ ...s, activated: s.activated + 1 })))
        .onUpdate(() => setGh((s) => ({ ...s, updates: s.updates + 1 })))
        .onEnd((_e, success) =>
          setGh((s) => (success ? { ...s, ended: s.ended + 1 } : { ...s, failed: s.failed + 1 })),
        ),
    [],
  );

  const reset = () => {
    setPlain({ down: 0, move: 0, up: 0, cancel: 0, maxPointers: 0, travel: 0 });
    setGh({ began: 0, activated: 0, updates: 0, ended: 0, failed: 0 });
  };

  const verdict = readVerdict(plain, gh);

  const share = async () => {
    await Share.share({
      message:
        `Touch test\n` +
        `plain: down=${plain.down} move=${plain.move} up=${plain.up} cancel=${plain.cancel} ` +
        `maxPointers=${plain.maxPointers} travel=${Math.round(plain.travel)}px\n` +
        `gesture-handler: began=${gh.began} activated=${gh.activated} updates=${gh.updates} ` +
        `ended=${gh.ended} failed=${gh.failed}\n` +
        `verdict: ${verdict.text}`,
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {onClose ? (
          <Pressable style={styles.backBtn} onPress={onClose} hitSlop={10}>
            <Feather name="chevron-left" size={22} color="#cbd5e1" />
          </Pressable>
        ) : null}
        <Text style={styles.heading}>Touch test</Text>
        <View style={styles.headerActions}>
          <Pressable style={styles.smallBtn} onPress={() => void share()}>
            <Text style={styles.smallBtnText}>Share</Text>
          </Pressable>
          <Pressable style={styles.smallBtn} onPress={reset}>
            <Text style={styles.smallBtnText}>Reset</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>
          Drag a slow circle inside each box for a couple of seconds, then press Share and send
          the numbers over.
        </Text>

        <Text style={styles.padTitle}>1 · Plain touch</Text>
        <View style={styles.pad} {...plainResponder.panHandlers}>
          <Text style={styles.padHint}>drag here</Text>
        </View>
        <View style={styles.readout}>
          <Metric label="down" value={plain.down} />
          <Metric label="move" value={plain.move} warnIfZero={plain.down > 0} />
          <Metric label="up" value={plain.up} />
          <Metric label="cancel" value={plain.cancel} warnIfAny />
          <Metric label="fingers" value={plain.maxPointers} />
          <Metric label="px" value={Math.round(plain.travel)} />
        </View>

        <Text style={styles.padTitle}>2 · Gesture handler</Text>
        <GestureDetector gesture={pan}>
          <View style={styles.pad}>
            <Text style={styles.padHint}>drag here</Text>
          </View>
        </GestureDetector>
        <View style={styles.readout}>
          <Metric label="began" value={gh.began} />
          <Metric label="active" value={gh.activated} warnIfZero={gh.began > 0} />
          <Metric label="update" value={gh.updates} warnIfZero={gh.began > 0} />
          <Metric label="end" value={gh.ended} />
          <Metric label="fail" value={gh.failed} warnIfAny />
        </View>

        <View style={[styles.verdict, { borderColor: verdict.color }]}>
          <Text style={[styles.verdictText, { color: verdict.color }]}>{verdict.text}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Metric({
  label,
  value,
  warnIfZero = false,
  warnIfAny = false,
}: {
  label: string;
  value: number;
  warnIfZero?: boolean;
  warnIfAny?: boolean;
}) {
  const bad = (warnIfZero && value === 0) || (warnIfAny && value > 0);
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, bad && styles.metricValueBad]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

type Plain = { down: number; move: number; up: number; cancel: number; maxPointers: number; travel: number };
type Gh = { began: number; activated: number; updates: number; ended: number; failed: number };

/** Turns the six counters into the one sentence that matters. */
function readVerdict(plain: Plain, gh: Gh): { text: string; color: string } {
  if (plain.down === 0 && gh.began === 0) {
    return { text: "Nothing recorded yet — drag inside both boxes.", color: "#5f7da0" };
  }
  if (plain.down > 0 && plain.move === 0) {
    return {
      text:
        "Touches land but no movement is reported. The drag is being eaten before it reaches the app — " +
        "screen protector, or an accessibility / floating-overlay service.",
      color: "#ff6b6b",
    };
  }
  if (plain.cancel > 0) {
    return {
      text: "Movement arrives and is then cancelled — something above is stealing the gesture.",
      color: "#f5c518",
    };
  }
  if (gh.began > 0 && gh.activated === 0) {
    return {
      text: "Plain touch is fine but gesture-handler never activates — drawers and sheets won't drag.",
      color: "#f5c518",
    };
  }
  if (plain.move > 0 && gh.updates > 0) {
    return { text: "Both paths are healthy on this device.", color: "#22ff88" };
  }
  return { text: "Keep dragging — not enough samples yet.", color: "#5f7da0" };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020b18" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  heading: { color: "#eff6ff", fontSize: 20, fontWeight: "900" },
  headerActions: { flexDirection: "row", gap: 8, marginLeft: "auto" },
  smallBtn: { backgroundColor: "#16263d", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  smallBtnText: { color: "#9fb3cc", fontSize: 12, fontWeight: "700" },
  body: { padding: 16, paddingBottom: 48, gap: 10 },
  intro: { color: "#7c8a9c", fontSize: 13, lineHeight: 19, marginBottom: 4 },
  padTitle: { color: "#9fb3cc", fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginTop: 6 },
  pad: {
    height: 130,
    borderRadius: 14,
    backgroundColor: "#0b1729",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  padHint: { color: "#3f5a7d", fontSize: 12, fontWeight: "700" },
  readout: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: {
    flexGrow: 1,
    minWidth: 52,
    backgroundColor: "#0b1729",
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.08)",
  },
  metricValue: { color: "#dbe6f3", fontSize: 17, fontWeight: "800", fontVariant: ["tabular-nums"] },
  metricValueBad: { color: "#ff6b6b" },
  metricLabel: { color: "#5f7da0", fontSize: 10, fontWeight: "700", marginTop: 2 },
  verdict: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    backgroundColor: "rgba(11,23,41,0.7)",
  },
  verdictText: { fontSize: 13, fontWeight: "700", lineHeight: 19 },
});
