import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

/**
 * Premium "selected marker" treatment: two concentric rings that breathe
 * outward and fade (radar sonar), a steady inner glow ring, and a soft tinted
 * backdrop. Wrap the marker's dot with this; pass the accent colour to match
 * the marker (red for incidents, the medic's freshness colour otherwise).
 *
 * `size` is the diameter of the wrapped dot in points.
 */
export function SelectionPulse({
  active = true,
  size,
  color = "#ffffff",
  children,
}: {
  active?: boolean;
  size: number;
  color?: string;
  children: React.ReactNode;
}) {
  const pulseA = useRef(new Animated.Value(0)).current;
  const pulseB = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    const makeRing = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 1650,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      );
    // Steady inner-glow breathing.
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 820, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 920, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      ]),
    );
    const a = makeRing(pulseA, 0);
    const b = makeRing(pulseB, 900);
    a.start();
    b.start();
    glowLoop.start();
    return () => {
      a.stop();
      b.stop();
      glowLoop.stop();
    };
  }, [active, pulseA, pulseB, glow]);

  if (!active) {
    return <View style={styles.wrap}>{children}</View>;
  }

  const ringBase = size + 18;
  const ringStyle = (value: Animated.Value) => ({
    position: "absolute" as const,
    width: ringBase,
    height: ringBase,
    borderRadius: ringBase / 2,
    borderWidth: 2,
    borderColor: color,
    opacity: value.interpolate({ inputRange: [0, 0.12, 0.72, 1], outputRange: [0, 0.72, 0.22, 0] }),
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.78, 2.28] }) }],
  });

  const glowSize = size + 22;
  const auraSize = size + 34;
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.34, 0.72] });
  const auraOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.26] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.16] });
  const auraScale = glow.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.08] });

  return (
    <View style={styles.wrap}>
      <Animated.View style={ringStyle(pulseA)} pointerEvents="none" />
      <Animated.View style={ringStyle(pulseB)} pointerEvents="none" />
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: auraSize,
          height: auraSize,
          borderRadius: auraSize / 2,
          backgroundColor: color,
          opacity: auraOpacity,
          transform: [{ scale: auraScale }],
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: glowSize,
          height: glowSize,
          borderRadius: glowSize / 2,
          backgroundColor: color,
          opacity: glowOpacity,
          transform: [{ scale: glowScale }],
          shadowColor: color,
          shadowOpacity: 0.9,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 0 },
          elevation: 18,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: size + 10,
          height: size + 10,
          borderRadius: (size + 10) / 2,
          borderWidth: 2,
          borderColor: "rgba(255,255,255,0.95)",
          backgroundColor: "rgba(255,255,255,0.12)",
        }}
      />
      <View style={styles.scaled}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  scaled: { transform: [{ scale: 1.08 }] },
});
