import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

/**
 * Eye-catching unread indicator for the bottom Chat tab: a count pill with a
 * soft pulsing halo behind it so new messages are noticeable at a glance.
 */
export function ChatTabBadge({ count }: { count: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 2.1] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View style={[styles.halo, { transform: [{ scale }], opacity }]} />
      <View style={styles.badge}>
        <Text style={styles.text}>{count > 9 ? "9+" : count}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: -7, right: -12, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", width: 18, height: 18, borderRadius: 9, backgroundColor: "#ef4444" },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: "#ef4444",
    borderWidth: 1.5,
    borderColor: "#020b18",
    alignItems: "center",
    justifyContent: "center",
  },
  text: { color: "#fff", fontSize: 9.5, fontWeight: "900" },
});
