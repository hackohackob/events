import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { startIncidentReport } from "./start-report";
import { useIncidentStore } from "./incident-store";

interface Props {
  /** Drop a new point at the reporter's current position. */
  onAddPoint: () => void;
}

/**
 * Plain-button stand-in for {@link IncidentFAB}, offered as "Simple report
 * buttons" in Debug ▸ Map settings.
 *
 * Same two actions, no fan-out and no animation — but the point of it is the
 * layout, not the looks. The FAB anchors itself with a full-screen
 * absolutely-positioned root at zIndex 35 and relies on `pointerEvents`
 * "box-none" to let the map underneath receive touches. On some Android devices
 * that does not happen: the invisible layer eats every drag and pinch, so the
 * map cannot be panned or zoomed while ordinary taps still work. This component
 * is positioned by its own corner instead, so it occupies its own footprint and
 * there is no full-screen layer over the map at all.
 *
 * Styled after the header's Menu/Layers buttons, which stayed reliably tappable
 * on the affected device.
 */
export function IncidentButtons({ onAddPoint }: Props) {
  const phase = useIncidentStore((s) => s.phase);

  if (phase !== "idle") return null;

  return (
    <View style={styles.column}>
      <Pressable
        style={[styles.button, styles.incidentButton]}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          void startIncidentReport();
        }}
        accessibilityLabel="Report incident"
      >
        <Feather name="alert-triangle" size={16} color="#fff" />
        <Text style={[styles.label, styles.incidentLabel]}>Incident</Text>
      </Pressable>

      <Pressable
        style={styles.button}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onAddPoint();
        }}
        accessibilityLabel="Add point here"
      >
        <Feather name="map-pin" size={16} color="#7dd3fc" />
        <Text style={styles.label}>Point</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Anchored by its own corner — deliberately NOT a full-screen container.
  column: {
    position: "absolute",
    right: 16,
    bottom: 76,
    alignItems: "flex-end",
    gap: 10,
    zIndex: 35,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    minWidth: 116,
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: "rgba(8, 15, 28, 0.93)",
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.22)",
  },
  incidentButton: {
    backgroundColor: "#FF3B3B",
    borderColor: "#ff6b6b",
  },
  label: { color: "#eff6ff", fontSize: 14, fontWeight: "800" },
  incidentLabel: { color: "#fff" },
});
