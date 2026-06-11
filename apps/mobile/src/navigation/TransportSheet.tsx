import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavStore } from "./nav-store";
import { useLocationStatus } from "../debug/location-status";
import { distanceMeters, formatDistance } from "./geo";
import { PROFILE_META, PROFILE_ORDER } from "./surface";
import type { RouteProfile } from "./types";

const BOTTOM_BAR_HEIGHT = 60;

/** Custom glyphs for profiles Feather doesn't cover well. */
function ProfileIcon({ profile, active }: { profile: RouteProfile; active: boolean }) {
  const color = active ? "#04121f" : "#cbd5e1";
  if (profile === "mtb") return <Text style={[styles.glyph, { color }]}>🚵</Text>;
  if (profile === "car") return <Text style={[styles.glyph, { color }]}>🚗</Text>;
  if (profile === "rescue_4x4") return <Text style={[styles.glyph, { color }]}>🛻</Text>;
  return <Feather name="user" size={20} color={color} />;
}

/**
 * Compact bottom sheet (≈22% height) shown after "Navigate here": destination
 * summary + the four transport choices. Picking one captures the current GPS
 * fix as the origin and kicks off route calculation.
 */
export function TransportSheet() {
  const phase = useNavStore((s) => s.phase);
  const destination = useNavStore((s) => s.destination);
  const selectProfile = useNavStore((s) => s.selectProfile);
  const cancel = useNavStore((s) => s.cancel);
  const loadingProfile = useNavStore((s) => (s.loading ? s.profile : null));
  const fix = useLocationStatus((s) => s.lastFix);

  if (phase !== "transport" || !destination) return null;

  const distanceLabel =
    fix != null ? formatDistance(distanceMeters(fix, destination)) : "Distance unknown";

  const choose = (profile: RouteProfile) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!fix) return;
    void selectProfile(profile, { lat: fix.lat, lng: fix.lng });
  };

  return (
    <View style={styles.sheet}>
      <View style={styles.grabber} />
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.destName} numberOfLines={1}>
            {destination.label}
          </Text>
          <Text style={styles.destMeta}>{distanceLabel} away • Choose transport</Text>
        </View>
        <Pressable style={styles.closeButton} onPress={cancel} hitSlop={10}>
          <Feather name="x" size={18} color="#94a3b8" />
        </Pressable>
      </View>

      {!fix ? <Text style={styles.warn}>Waiting for GPS fix…</Text> : null}

      <View style={styles.row}>
        {PROFILE_ORDER.map((profile) => {
          const busy = loadingProfile === profile;
          return (
            <Pressable
              key={profile}
              style={({ pressed }) => [styles.choice, pressed && styles.choicePressed]}
              onPress={() => choose(profile)}
              disabled={!fix}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#34d399" />
              ) : (
                <ProfileIcon profile={profile} active={false} />
              )}
              <Text style={styles.choiceLabel}>{PROFILE_META[profile].label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: BOTTOM_BAR_HEIGHT,
    backgroundColor: "#0a1322",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 18,
    zIndex: 60,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 24,
  },
  grabber: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(177,199,224,0.28)",
    marginBottom: 12,
  },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  headerText: { flex: 1, paddingRight: 10 },
  destName: { color: "#EFF6FF", fontSize: 17, fontWeight: "900", letterSpacing: 0.2 },
  destMeta: { color: "#64748b", fontSize: 12.5, fontWeight: "700", marginTop: 2 },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(148,163,184,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  warn: { color: "#f59e0b", fontSize: 12, fontWeight: "700", marginBottom: 8 },
  row: { flexDirection: "row", gap: 9 },
  choice: {
    flex: 1,
    backgroundColor: "#111d31",
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    paddingVertical: 14,
    alignItems: "center",
    gap: 7,
  },
  choicePressed: { backgroundColor: "#16243c", borderColor: "rgba(52,211,153,0.5)" },
  choiceLabel: { color: "#dbe7f5", fontSize: 12.5, fontWeight: "800" },
  glyph: { fontSize: 20 },
});
