import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { startIncidentReport } from "./start-report";
import { useIncidentStore } from "./incident-store";

interface Props {
  /** Drop a new point at the reporter's current position. */
  onAddPoint: () => void;
}

/**
 * The map's primary "+" button. Pressing it no longer fires a report straight
 * away: it fans out into the same two choices the long-press radial menu
 * offers — report an incident, or add a point — so a mis-tap can't raise an
 * incident, and adding a point at your own position takes one gesture.
 */
export function IncidentFAB({ onAddPoint }: Props) {
  const phase = useIncidentStore((s) => s.phase);
  const [pressing, setPressing] = useState(false);
  const [open, setOpen] = useState(false);

  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.7)).current;
  const fabScale = useRef(new Animated.Value(1)).current;
  const fan = useRef(new Animated.Value(0)).current;

  // Restart the pulse each time the FAB becomes visible again. A native-driven
  // loop halts when its target view is detached (we render null while a report is
  // in progress) and does not auto-resume on remount — so re-arm it on idle.
  // While the menu is open the pulse would fight the fanned-out actions.
  useEffect(() => {
    if (phase !== "idle" || open) return;
    pulseScale.setValue(1);
    pulseOpacity.setValue(0.7);
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.85, duration: 1100, useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 0, duration: 1100, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.7, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, open, pulseScale, pulseOpacity]);

  useEffect(() => {
    Animated.timing(fan, {
      toValue: open ? 1 : 0,
      duration: open ? 190 : 140,
      easing: open ? Easing.out(Easing.back(1.6)) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [open, fan]);

  const close = useCallback(() => setOpen(false), []);

  const toggle = () => {
    if (phase !== "idle") return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.sequence([
      Animated.spring(fabScale, { toValue: 0.88, damping: 28, mass: 1, stiffness: 280, useNativeDriver: true }),
      Animated.spring(fabScale, { toValue: 1, damping: 28, mass: 1, stiffness: 280, useNativeDriver: true }),
    ]).start();
    setOpen((v) => !v);
  };

  const chooseIncident = () => {
    close();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    void startIncidentReport();
  };

  const choosePoint = () => {
    close();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onAddPoint();
  };

  if (phase !== "idle") return null;

  // The cross doubles as the close affordance: 45° turns "+" into "×".
  const crossRotation = fan.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "45deg"] });

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Tap anywhere else to dismiss — the map underneath stays untouched. */}
      {open ? <Pressable style={StyleSheet.absoluteFill} onPress={close} /> : null}

      <View style={styles.column} pointerEvents="box-none">
        <FanAction
          fan={fan}
          index={1}
          open={open}
          label="Add incident"
          icon="alert-triangle"
          color="#FF3B3B"
          onPress={chooseIncident}
        />
        <FanAction
          fan={fan}
          index={0}
          open={open}
          label="Add point"
          icon="map-pin"
          color="#3b82f6"
          onPress={choosePoint}
        />

        <View style={styles.fabSlot}>
          <Animated.View
            style={[styles.pulseRing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]}
            pointerEvents="none"
          />
          <Pressable onPress={toggle} onPressIn={() => setPressing(true)} onPressOut={() => setPressing(false)}>
            <Animated.View
              style={[styles.fab, pressing && styles.fabPressed, { transform: [{ scale: fabScale }] }]}
            >
              <Animated.View style={[styles.cross, { transform: [{ rotate: crossRotation }] }]}>
                <View style={styles.crossH} />
                <View style={styles.crossV} />
              </Animated.View>
            </Animated.View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** One fanned-out choice: label pill + round button, rising off the FAB. */
function FanAction({
  fan, index, open, label, icon, color, onPress,
}: {
  fan: Animated.Value;
  /** Distance from the FAB, in slots — staggers the rise. */
  index: number;
  open: boolean;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  onPress: () => void;
}) {
  const lift = (index + 1) * (MINI_SIZE + 12);
  return (
    <Animated.View
      pointerEvents={open ? "auto" : "none"}
      style={[
        styles.action,
        {
          opacity: fan,
          transform: [{ translateY: fan.interpolate({ inputRange: [0, 1], outputRange: [lift, 0] }) }],
        },
      ]}
    >
      <Pressable style={styles.actionRow} onPress={onPress} hitSlop={6}>
        <View style={styles.actionLabel}>
          <Text style={styles.actionLabelText} numberOfLines={1}>{label}</Text>
        </View>
        <View style={[styles.mini, { backgroundColor: color, shadowColor: color }]}>
          <Feather name={icon} size={19} color="#fff" />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const FAB_SIZE = 62;
const MINI_SIZE = 46;

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 35 },
  column: {
    position: "absolute",
    bottom: 76,
    right: 16,
    alignItems: "flex-end",
    gap: 12,
  },
  fabSlot: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    borderWidth: 2.5,
    borderColor: "rgba(255, 59, 59, 0.65)",
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: "#FF3B3B",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#FF3B3B",
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  fabPressed: {
    backgroundColor: "#e02c2c",
  },
  cross: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  crossH: {
    position: "absolute",
    width: 26,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#fff",
  },
  crossV: {
    position: "absolute",
    width: 5,
    height: 26,
    borderRadius: 3,
    backgroundColor: "#fff",
  },

  action: { alignItems: "flex-end" },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  actionLabel: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(8, 15, 28, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.22)",
  },
  actionLabelText: { color: "#E9F1FA", fontSize: 12.5, fontWeight: "800" },
  mini: {
    width: MINI_SIZE,
    height: MINI_SIZE,
    borderRadius: MINI_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
});
