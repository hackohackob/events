import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

interface Props {
  initials: string;
  dotColor: string;
  isGrey: boolean;
  /** Responding to an incident → the whole dot flashes red/blue. */
  isResponding: boolean;
  /** On station / holding → green dot with an anchor badge. */
  isStationary: boolean;
  /** Heading to a plain point → a "moving" badge. */
  isGoingToPoint: boolean;
  /** Faded out — the viewer is focused on their own incident. */
  dimmed?: boolean;
  /** Currently selected on the map → bright halo ring + slight scale-up. */
  selected?: boolean;
}

const FLASH_MS = 460;

/**
 * Medic map marker. When responding to an incident the entire dot pulses between
 * red and blue (emergency lights). The flash runs on this component's own timer
 * so it stays smooth without re-rendering the whole map.
 */
export function MedicDot({ initials, dotColor, isGrey, isResponding, isStationary, isGoingToPoint, dimmed = false, selected = false }: Props) {
  const [flashBlue, setFlashBlue] = useState(false);

  useEffect(() => {
    if (!isResponding || isGrey) return;
    const timer = setInterval(() => setFlashBlue((v) => !v), FLASH_MS);
    return () => clearInterval(timer);
  }, [isResponding, isGrey]);

  const responding = isResponding && !isGrey;
  const background = responding ? (flashBlue ? "#2563eb" : "#ef4444") : dotColor;
  const glow = responding ? (flashBlue ? "#2563eb" : "#ef4444") : "transparent";

  return (
    <View style={[styles.wrap, dimmed && !selected && styles.wrapDimmed, selected && styles.wrapSelected]}>
      <View
        style={[
          styles.dot,
          { backgroundColor: background },
          isGrey && styles.dotStale,
          responding && { shadowColor: glow, shadowOpacity: 0.95, shadowRadius: 9, elevation: 10, borderColor: "#FFFFFF" },
        ]}
      >
        <Text style={[styles.text, isGrey && styles.textStale]} numberOfLines={1} allowFontScaling={false}>
          {initials}
        </Text>
      </View>
      {isStationary && !isGrey ? (
        <View style={[styles.badge, styles.stationaryBadge]}>
          <Feather name="anchor" size={9} color="#04121f" />
        </View>
      ) : null}
      {isGoingToPoint && !isGrey ? (
        <View style={[styles.badge, styles.movingBadge]}>
          <Feather name="navigation" size={9} color="#04121f" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  wrapDimmed: { opacity: 0.55 },
  // Selected on the map: bright halo ring + scale so it stands out from peers.
  wrapSelected: {
    padding: 4,
    borderRadius: 999,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.95)",
    backgroundColor: "rgba(255,255,255,0.18)",
    transform: [{ scale: 1.12 }],
    shadowColor: "#fff",
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 10,
  },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  dotStale: { backgroundColor: "#475569", borderColor: "rgba(255,255,255,0.4)", opacity: 0.65 },
  text: { color: "#ffffff", fontSize: 11, fontWeight: "900", lineHeight: 13, textAlign: "center", includeFontPadding: false },
  textStale: { color: "rgba(255,255,255,0.7)" },
  badge: {
    position: "absolute",
    bottom: -3,
    right: -3,
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#04121f",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
  },
  stationaryBadge: { backgroundColor: "#34d399" },
  movingBadge: { backgroundColor: "#fbbf24" },
});
