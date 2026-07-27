import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { PttChannelKind } from "@events/contracts";

/**
 * The bidirectional bridge control: two nodes, one tappable lane per direction.
 *
 * The two directions are separate switches because that is how they are used —
 * "hear the radio without our chatter going out on it" is the common setting.
 * An enabled lane marches its dashes toward the destination so the direction
 * reads at a glance, and a live connection sends a bright packet along it.
 */

export const CHANNEL_THEME: Record<PttChannelKind, { color: string; icon: keyof typeof Feather.glyphMap; label: string }> = {
  zello: { color: "#f59e0b", icon: "radio", label: "Zello" },
  radio: { color: "#38bdf8", icon: "wifi", label: "Digital radio" },
};

const DASH_PERIOD = 26; // one dash + one gap

interface Props {
  kind: PttChannelKind;
  inbound: boolean;
  outbound: boolean;
  /** The server actually holds a connection to this network right now. */
  live: boolean;
  disabled?: boolean;
  busy?: boolean;
  onToggle: (direction: "inbound" | "outbound", next: boolean) => void;
}

export function BridgeFlowControl({ kind, inbound, outbound, live, disabled = false, busy = false, onToggle }: Props) {
  const theme = CHANNEL_THEME[kind];

  return (
    <View style={[styles.wrap, disabled && styles.wrapDisabled]}>
      <View style={styles.row}>
        <Node icon="smartphone" label="App" sub="Team chat" color="#34d399" live />
        <View style={styles.lanes}>
          <Lane
            direction="outbound"
            title={`App → ${theme.label}`}
            enabled={outbound && !disabled}
            live={live}
            color={theme.color}
            disabled={disabled || busy}
            onPress={() => onToggle("outbound", !outbound)}
          />
          <Lane
            direction="inbound"
            title={`${theme.label} → App`}
            enabled={inbound && !disabled}
            live={live}
            color={theme.color}
            disabled={disabled || busy}
            onPress={() => onToggle("inbound", !inbound)}
          />
        </View>
        <Node icon={theme.icon} label={theme.label} sub={live ? "Connected" : "Offline"} color={theme.color} live={live} />
      </View>
    </View>
  );
}

function Node({
  icon,
  label,
  sub,
  color,
  live,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  sub: string;
  color: string;
  live: boolean;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!live) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);

  return (
    <View style={styles.node}>
      <View style={[styles.nodeIcon, { backgroundColor: `${color}1a`, borderColor: `${color}55` }]}>
        {live ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.nodeHalo,
              {
                borderColor: color,
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.5] }) }],
              },
            ]}
          />
        ) : null}
        <Feather name={icon} size={17} color={color} />
      </View>
      <Text style={styles.nodeLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.nodeSub, live && { color }]} numberOfLines={1}>
        {sub}
      </Text>
    </View>
  );
}

function Lane({
  direction,
  title,
  enabled,
  live,
  color,
  disabled,
  onPress,
}: {
  direction: "inbound" | "outbound";
  title: string;
  enabled: boolean;
  live: boolean;
  color: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const reverse = direction === "inbound";
  const [width, setWidth] = useState(0);
  const march = useRef(new Animated.Value(0)).current;
  const packet = useRef(new Animated.Value(0)).current;

  // Marching dashes: the strip is one period wider than the lane, so sliding it
  // by exactly one period loops seamlessly.
  useEffect(() => {
    if (!enabled) {
      march.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(march, { toValue: 1, duration: 850, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [enabled, march]);

  useEffect(() => {
    if (!enabled || !live || width === 0) {
      packet.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(packet, { toValue: 1, duration: 1700, easing: Easing.linear, useNativeDriver: true }),
        Animated.delay(400),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enabled, live, width, packet]);

  const dashCount = Math.ceil((width + DASH_PERIOD) / DASH_PERIOD);
  const marchShift = march.interpolate({
    inputRange: [0, 1],
    outputRange: reverse ? [0, DASH_PERIOD] : [0, -DASH_PERIOD],
  });
  const packetShift = packet.interpolate({
    inputRange: [0, 1],
    outputRange: reverse ? [width, -22] : [-22, width],
  });

  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: enabled, disabled }}
      accessibilityLabel={title}
      style={({ pressed }) => [styles.lane, pressed && !disabled ? { opacity: 0.65 } : null]}
    >
      <View style={[styles.laneHeader, reverse && styles.laneHeaderReverse]}>
        {reverse ? <Feather name="arrow-left" size={12} color={enabled ? color : "#3f5064"} /> : null}
        <Text style={[styles.laneTitle, { color: enabled ? color : "#4b5c72" }]} numberOfLines={1}>
          {title}
        </Text>
        {!reverse ? <Feather name="arrow-right" size={12} color={enabled ? color : "#3f5064"} /> : null}
        <View style={{ flex: 1 }} />
        <View style={[styles.pill, enabled ? { backgroundColor: `${color}22`, borderColor: `${color}66` } : null]}>
          <Text style={[styles.pillText, enabled && { color }]}>{enabled ? "ON" : "OFF"}</Text>
        </View>
      </View>

      <View style={styles.track} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <Animated.View
          style={[
            styles.dashStrip,
            { width: width + DASH_PERIOD, transform: [{ translateX: marchShift }] },
          ]}
        >
          {Array.from({ length: Math.max(dashCount, 1) }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dash,
                enabled
                  ? { backgroundColor: color, width: 13 }
                  : { backgroundColor: "rgba(148,163,184,0.28)", width: 5 },
              ]}
            />
          ))}
        </Animated.View>

        {enabled && live && width > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.packet, { backgroundColor: "#ffffff", transform: [{ translateX: packetShift }] }]}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "rgba(255,255,255,0.025)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.1)",
    padding: 12,
  },
  wrapDisabled: { opacity: 0.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  lanes: { flex: 1, gap: 12 },

  node: { width: 66, alignItems: "center", gap: 4 },
  nodeIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  nodeHalo: { position: "absolute", left: -1, top: -1, right: -1, bottom: -1, borderRadius: 15, borderWidth: 1.5 },
  nodeLabel: { color: "#cbd5e1", fontSize: 11, fontWeight: "900" },
  nodeSub: { color: "#5a6b80", fontSize: 9, fontWeight: "700" },

  lane: { gap: 5 },
  laneHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  laneHeaderReverse: { flexDirection: "row" },
  laneTitle: { fontSize: 10, fontWeight: "900", letterSpacing: 0.4 },
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
    backgroundColor: "rgba(148,163,184,0.1)",
  },
  pillText: { fontSize: 8.5, fontWeight: "900", color: "#64748b", letterSpacing: 0.5 },

  track: { height: 4, borderRadius: 2, overflow: "hidden", justifyContent: "center" },
  dashStrip: { flexDirection: "row", alignItems: "center", gap: 13, height: 4 },
  dash: { height: 3, borderRadius: 2 },
  packet: { position: "absolute", width: 22, height: 3, borderRadius: 2, opacity: 0.9 },
});
