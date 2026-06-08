import React from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LOCATION_INTERVAL_OPTIONS, useSettingsStore } from "./settings-store";
import { startLocationLoop } from "../location/location-tracker";

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const locationIntervalMs = useSettingsStore((s) => s.locationIntervalMs);
  const setLocationIntervalMs = useSettingsStore((s) => s.setLocationIntervalMs);
  const trackOffsetEnabled = useSettingsStore((s) => s.trackOffsetEnabled);
  const setTrackOffsetEnabled = useSettingsStore((s) => s.setTrackOffsetEnabled);

  const pickInterval = (ms: number) => {
    if (ms === locationIntervalMs) return;
    setLocationIntervalMs(ms);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Restart the background updates so the new cadence takes effect immediately.
    void startLocationLoop();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onClose} hitSlop={10}>
          <Feather name="chevron-left" size={22} color="#cbd5e1" />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ── Map ─────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>MAP</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Spread overlapping tracks</Text>
              <Text style={styles.rowSub}>
                Draw routes that share the same path side by side, instead of one drawn over the other.
              </Text>
            </View>
            <Switch
              value={trackOffsetEnabled}
              onValueChange={(v) => {
                setTrackOffsetEnabled(v);
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              trackColor={{ false: "#1e293b", true: "#16a34a" }}
              thumbColor="#f1f5f9"
            />
          </View>
        </View>

        {/* ── Location tracking ───────────────────────────────── */}
        <Text style={styles.sectionLabel}>LOCATION TRACKING</Text>
        <View style={styles.card}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Update frequency</Text>
            <Text style={styles.rowSub}>How often your location is sent to the command centre.</Text>
          </View>
          <View style={styles.optionsWrap}>
            {LOCATION_INTERVAL_OPTIONS.map((opt) => {
              const active = opt.ms === locationIntervalMs;
              return (
                <Pressable
                  key={opt.ms}
                  onPress={() => pickInterval(opt.ms)}
                  style={[styles.optionPill, active && styles.optionPillActive]}
                >
                  <Text style={[styles.optionText, active && styles.optionTextActive]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.note}>
            Lower frequencies save battery. A persistent notification keeps tracking alive in the background.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050b16" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.1)",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  headerTitle: { color: "#EFF6FF", fontSize: 17, fontWeight: "900", letterSpacing: 0.3 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 60, gap: 6 },
  sectionLabel: {
    color: "#475569",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: "#0c1626",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.1)",
    padding: 16,
    gap: 12,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  rowText: { flex: 1 },
  rowTitle: { color: "#e2e8f0", fontSize: 15, fontWeight: "800" },
  rowSub: { color: "#64748b", fontSize: 12.5, fontWeight: "500", marginTop: 3, lineHeight: 17 },
  optionsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionPill: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: "rgba(148,163,184,0.18)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  optionPillActive: { borderColor: "#34d399", backgroundColor: "rgba(34,197,94,0.16)" },
  optionText: { color: "#94a3b8", fontSize: 13, fontWeight: "800" },
  optionTextActive: { color: "#34d399" },
  note: { color: "#475569", fontSize: 11.5, fontWeight: "500", lineHeight: 16 },
});
