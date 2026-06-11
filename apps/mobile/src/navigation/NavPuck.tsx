import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

const FLASH_MS = 460; // matches MedicDot's emergency-light cadence

/**
 * Premium navigation puck: a glossy blue dot with a translucent direction
 * "beam" (flashlight cone) pointing the travel direction, and a soft pulsing
 * accuracy halo. `rotation` is the on-screen heading in degrees.
 *
 * When `responding` (navigating to an incident) the dot and halo flash
 * red/blue like emergency lights; plain navigation stays blue.
 */
export function NavPuck({ rotation, responding = false }: { rotation: number; responding?: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const [flashBlue, setFlashBlue] = useState(false);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    if (!responding) return;
    const timer = setInterval(() => setFlashBlue((v) => !v), FLASH_MS);
    return () => clearInterval(timer);
  }, [responding]);

  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.5] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.45, 0] });

  const dotColor = responding ? (flashBlue ? "#2563eb" : "#ef4444") : "#2563eb";
  const haloColor = responding ? (flashBlue ? "#3b82f6" : "#ef4444") : "#3b82f6";

  return (
    <View style={styles.wrap}>
      <Animated.View
        style={[styles.halo, { backgroundColor: haloColor, transform: [{ scale: haloScale }], opacity: haloOpacity }]}
      />
      <View style={[styles.rotor, { transform: [{ rotate: `${rotation}deg` }] }]}>
        <View style={styles.beam} />
        <View style={styles.beamCore} />
        <View style={styles.dotShadow} />
        <View style={[styles.dot, { backgroundColor: dotColor }]}>
          <View style={styles.dotGloss} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  halo: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#3b82f6",
  },
  rotor: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  // Wide soft beam (▽, apex at the dot) projecting forward.
  beam: {
    position: "absolute",
    top: 6,
    width: 0,
    height: 0,
    borderLeftWidth: 22,
    borderRightWidth: 22,
    borderTopWidth: 30,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "rgba(59,130,246,0.22)",
  },
  // Brighter inner beam for a focused light look.
  beamCore: {
    position: "absolute",
    top: 9,
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderTopWidth: 22,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "rgba(96,165,250,0.4)",
  },
  dotShadow: {
    position: "absolute",
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#000",
    opacity: 0.25,
    transform: [{ translateY: 1.5 }],
  },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#2563eb",
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  // Subtle top highlight for a glossy 3D feel.
  dotGloss: {
    position: "absolute",
    top: -4,
    width: 18,
    height: 12,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.45)",
  },
});
