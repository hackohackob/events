import React from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavStore } from "./nav-store";
import { useLocationStatus } from "../debug/location-status";
import { PROFILE_META, PROFILE_ORDER } from "./surface";
import type { RouteProfile } from "./types";

/** Tiny glyph per profile (Feather has no bike/car/4x4 that read well at size). */
function glyph(profile: RouteProfile): string | null {
  if (profile === "mtb") return "🚵";
  if (profile === "car") return "🚗";
  if (profile === "rescue_4x4") return "🛻";
  return null; // foot uses a Feather icon
}

/**
 * Compact segmented transport switcher used on the route-variants step so the
 * mode (Foot / MTB / Car / 4x4) stays changeable without going back. Switching
 * re-routes for the new profile from the same origin/destination.
 */
export function CompactTransportRow({ style }: { style?: StyleProp<ViewStyle> }) {
  const profile = useNavStore((s) => s.profile);
  const origin = useNavStore((s) => s.origin);
  const selectProfile = useNavStore((s) => s.selectProfile);
  const fix = useLocationStatus((s) => s.lastFix);

  const switchTo = (next: RouteProfile) => {
    if (next === profile) return;
    void Haptics.selectionAsync();
    const start = origin ?? (fix ? { lat: fix.lat, lng: fix.lng } : null);
    if (!start) return;
    void selectProfile(next, start);
  };

  return (
    <View style={[styles.row, style]}>
      {PROFILE_ORDER.map((p) => {
        const active = p === profile;
        const g = glyph(p);
        return (
          <Pressable
            key={p}
            onPress={() => switchTo(p)}
            style={[styles.seg, active && styles.segActive]}
          >
            {g ? (
              <Text style={[styles.segGlyph, !active && styles.segGlyphInactive]}>{g}</Text>
            ) : (
              <Feather name="user" size={15} color={active ? "#04121f" : "#94a3b8"} />
            )}
            <Text style={[styles.segLabel, active && styles.segLabelActive]}>{PROFILE_META[p].label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: "rgba(17,29,49,0.7)",
    borderRadius: 12,
    padding: 4,
  },
  seg: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 7,
    borderRadius: 9,
  },
  segActive: { backgroundColor: "#34d399" },
  segGlyph: { fontSize: 14 },
  segGlyphInactive: { opacity: 0.65 },
  segLabel: { color: "#94a3b8", fontSize: 11.5, fontWeight: "800" },
  segLabelActive: { color: "#04121f" },
});
