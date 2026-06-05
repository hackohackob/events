import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { startIncidentReport } from "./start-report";
import { useIncidentStore } from "./incident-store";

export function IncidentFAB() {
  const phase = useIncidentStore((s) => s.phase);
  const [pressing, setPressing] = useState(false);

  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.7)).current;
  const fabScale = useRef(new Animated.Value(1)).current;

  // Restart the pulse each time the FAB becomes visible again. A native-driven
  // loop halts when its target view is detached (we render null while a report is
  // in progress) and does not auto-resume on remount — so re-arm it on idle.
  useEffect(() => {
    if (phase !== "idle") return;
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
  }, [phase, pulseScale, pulseOpacity]);

  const handlePress = async () => {
    if (phase !== "idle") return;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    Animated.sequence([
      Animated.spring(fabScale, { toValue: 0.88, damping: 28, mass: 1, stiffness: 280, useNativeDriver: true }),
      Animated.spring(fabScale, { toValue: 1, damping: 28, mass: 1, stiffness: 280, useNativeDriver: true }),
    ]).start();

    await startIncidentReport();
  };

  if (phase !== "idle") return null;

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.pulseRing,
          { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
        ]}
        pointerEvents="none"
      />
      <Pressable
        onPress={handlePress}
        onPressIn={() => setPressing(true)}
        onPressOut={() => setPressing(false)}
      >
        <Animated.View
          style={[
            styles.fab,
            pressing && styles.fabPressed,
            { transform: [{ scale: fabScale }] },
          ]}
        >
          <View style={styles.crossH} />
          <View style={styles.crossV} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

const FAB_SIZE = 62;

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 76,
    right: 16,
    zIndex: 35,
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
});
