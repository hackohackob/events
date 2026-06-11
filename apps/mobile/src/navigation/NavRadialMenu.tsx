import React, { useEffect, useRef } from "react";
import { Animated, Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const RADIUS = 96;
const MENU_HALF = RADIUS + 56;

export interface RadialAnchor {
  /** Screen-space press location from the map's onLongPress event. */
  x: number;
  y: number;
  lat: number;
  lng: number;
}

interface Props {
  anchor: RadialAnchor | null;
  onNavigate: () => void;
  onMarkIncident: () => void;
  onAddPoint: () => void;
  onCancel: () => void;
}

interface Action {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  angle: number; // degrees, 0 = up
  primary?: boolean;
  onPress: () => void;
}

/**
 * Contextual radial menu shown at a long-pressed map point. "Navigate here" is
 * the primary action; the press location is clamped on-screen so the wheel never
 * spills past the edges.
 */
export function NavRadialMenu({ anchor, onNavigate, onMarkIncident, onAddPoint, onCancel }: Props) {
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (anchor) {
      scale.setValue(0);
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6, tension: 80 }).start();
    }
  }, [anchor, scale]);

  if (!anchor) return null;

  const cx = Math.max(MENU_HALF, Math.min(SCREEN_W - MENU_HALF, anchor.x));
  const cy = Math.max(MENU_HALF + 40, Math.min(SCREEN_H - MENU_HALF - 40, anchor.y));

  const actions: Action[] = [
    { key: "nav", label: "Navigate\nHere", icon: "navigation", color: "#22c55e", angle: 0, primary: true, onPress: onNavigate },
    { key: "incident", label: "Mark\nIncident", icon: "plus-circle", color: "#ef4444", angle: 90, onPress: onMarkIncident },
    { key: "cancel", label: "Cancel", icon: "x", color: "#94a3b8", angle: 180, onPress: onCancel },
    { key: "poi", label: "Add\nPoint", icon: "map-pin", color: "#3b82f6", angle: 270, onPress: onAddPoint },
  ];

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="box-none">
      {/* Dim scrim — fades in with the menu so labels read clearly over the map. */}
      <Animated.View style={[styles.scrim, { opacity: scale }]} pointerEvents="none" />
      <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />

      {/* Focus ring + pin at the pressed location. */}
      <Animated.View
        style={[styles.focusRing, { left: cx - 70, top: cy - 70, opacity: scale, transform: [{ scale }] }]}
        pointerEvents="none"
      />
      <View style={[styles.pin, { left: cx - 11, top: cy - 11 }]} pointerEvents="none" />

      {actions.map((action) => {
        const rad = (action.angle - 90) * (Math.PI / 180);
        const dx = Math.cos(rad) * RADIUS;
        const dy = Math.sin(rad) * RADIUS;
        const size = action.primary ? 70 : 60;
        return (
          <Animated.View
            key={action.key}
            style={[
              styles.actionWrap,
              {
                left: cx - 50,
                top: cy - 50,
                transform: [{ translateX: Animated.multiply(scale, dx) }, { translateY: Animated.multiply(scale, dy) }, { scale }],
              },
            ]}
          >
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  borderColor: action.color,
                  shadowColor: action.color,
                },
                action.primary && styles.actionButtonPrimary,
                pressed && styles.actionButtonPressed,
              ]}
              onPress={action.onPress}
            >
              <View style={[styles.iconHalo, { backgroundColor: `${action.color}22` }]}>
                <Feather name={action.icon} size={action.primary ? 26 : 22} color={action.color} />
              </View>
            </Pressable>
            <View style={[styles.labelPill, action.primary && { borderColor: `${action.color}88` }]}>
              <Text style={[styles.actionLabel, action.primary && { color: action.color }]}>{action.label}</Text>
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Above the map header (zIndex 21) so the action buttons are tappable anywhere.
  overlay: { zIndex: 60, elevation: 60 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(2,6,15,0.6)" },
  focusRing: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: "rgba(124,58,237,0.5)",
    backgroundColor: "rgba(124,58,237,0.08)",
  },
  pin: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#7c3aed",
    borderWidth: 3,
    borderColor: "#FFFFFF",
    shadowColor: "#7c3aed",
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 8,
  },
  actionWrap: { position: "absolute", width: 100, alignItems: "center" },
  actionButton: {
    backgroundColor: "rgba(9,14,24,0.97)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  actionButtonPrimary: { backgroundColor: "rgba(7,18,12,0.98)" },
  actionButtonPressed: { backgroundColor: "rgba(20,30,48,0.98)", transform: [{ scale: 0.94 }] },
  iconHalo: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  labelPill: {
    marginTop: 7,
    backgroundColor: "rgba(6,11,20,0.95)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.25)",
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  actionLabel: {
    color: "#eef4fb",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 13,
  },
});
