import React, { useCallback, useEffect, useState } from "react";
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LOCATION_INTERVAL_OPTIONS, useSettingsStore } from "./settings-store";
import { startLocationLoop } from "../location/location-tracker";
import { isDndBypassGranted, openDndAccessSettings } from "../notifications/dnd-access";

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const locationIntervalMs = useSettingsStore((s) => s.locationIntervalMs);
  const setLocationIntervalMs = useSettingsStore((s) => s.setLocationIntervalMs);
  const [intervalOpen, setIntervalOpen] = useState(false);
  const trackOffsetEnabled = useSettingsStore((s) => s.trackOffsetEnabled);
  const setTrackOffsetEnabled = useSettingsStore((s) => s.setTrackOffsetEnabled);
  const trackGradientEnabled = useSettingsStore((s) => s.trackGradientEnabled);
  const setTrackGradientEnabled = useSettingsStore((s) => s.setTrackGradientEnabled);

  const pickInterval = (ms: number) => {
    if (ms === locationIntervalMs) return;
    setLocationIntervalMs(ms);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Restart the background updates so the new cadence takes effect immediately.
    void startLocationLoop();
  };

  // Whether the incident alarm may ring through Do Not Disturb (Android DND
  // access). Re-probed whenever the app returns from the system settings.
  const [dndBypass, setDndBypass] = useState<boolean | null>(null);
  const refreshDndBypass = useCallback(() => {
    if (Platform.OS !== "android") return;
    void isDndBypassGranted().then(setDndBypass);
  }, []);
  useEffect(() => {
    refreshDndBypass();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshDndBypass();
    });
    return () => sub.remove();
  }, [refreshDndBypass]);

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
          <View style={[styles.row, styles.rowDivider]}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Track gradient shading</Text>
              <Text style={styles.rowSub}>
                Shade tracks by slope/elevation gradient instead of a flat colour.
              </Text>
            </View>
            <Switch
              value={trackGradientEnabled}
              onValueChange={(v) => {
                setTrackGradientEnabled(v);
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
          {/* Compact dropdown instead of a long row of pills. */}
          <Pressable
            style={styles.dropdownButton}
            onPress={() => {
              void Haptics.selectionAsync();
              setIntervalOpen((o) => !o);
            }}
          >
            <Text style={styles.dropdownValue}>
              {LOCATION_INTERVAL_OPTIONS.find((o) => o.ms === locationIntervalMs)?.label ?? "—"}
            </Text>
            <Feather name={intervalOpen ? "chevron-up" : "chevron-down"} size={18} color="#7e90a8" />
          </Pressable>
          {intervalOpen ? (
            <View style={styles.dropdownMenu}>
              {LOCATION_INTERVAL_OPTIONS.map((opt) => {
                const active = opt.ms === locationIntervalMs;
                return (
                  <Pressable
                    key={opt.ms}
                    onPress={() => {
                      pickInterval(opt.ms);
                      setIntervalOpen(false);
                    }}
                    style={[styles.dropdownItem, active && styles.dropdownItemActive]}
                  >
                    <Text style={[styles.dropdownItemText, active && styles.dropdownItemTextActive]}>{opt.label}</Text>
                    {active ? <Feather name="check" size={15} color="#34d399" /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <Text style={styles.note}>
            Lower frequencies save battery. A persistent notification keeps tracking alive in the background.
          </Text>
        </View>

        {/* ── Alerts ──────────────────────────────────────────── */}
        {Platform.OS === "android" ? (
          <>
            <Text style={styles.sectionLabel}>ALERTS</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Alarm in Do Not Disturb</Text>
                  <Text style={styles.rowSub}>
                    {dndBypass
                      ? "Incident alarms will ring through Do Not Disturb."
                      : "Grant the app Do Not Disturb access so incident alarms ring even in DND."}
                  </Text>
                </View>
                {dndBypass ? (
                  <Feather name="check-circle" size={20} color="#34d399" />
                ) : (
                  <Pressable
                    style={styles.grantBtn}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      void openDndAccessSettings();
                    }}
                  >
                    <Text style={styles.grantBtnText}>Allow</Text>
                  </Pressable>
                )}
              </View>
              <Text style={styles.note}>
                Alarms play on the alarm volume, so they stay audible when the ring volume is down. Keep the
                alarm volume up.
              </Text>
            </View>
          </>
        ) : null}
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
  rowDivider: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(148,163,184,0.12)" },
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
  dropdownButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  dropdownValue: { color: "#e7eef8", fontSize: 14.5, fontWeight: "800" },
  dropdownMenu: {
    marginTop: 6,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    backgroundColor: "rgba(255,255,255,0.03)",
    overflow: "hidden",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  dropdownItemActive: { backgroundColor: "rgba(52,211,153,0.1)" },
  dropdownItemText: { color: "#cbd5e1", fontSize: 14, fontWeight: "700" },
  dropdownItemTextActive: { color: "#34d399" },
  note: { color: "#475569", fontSize: 11.5, fontWeight: "500", lineHeight: 16, marginTop: 12 },
  grantBtn: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: "rgba(52,211,153,0.5)",
    backgroundColor: "rgba(34,197,94,0.16)",
  },
  grantBtnText: { color: "#34d399", fontSize: 13, fontWeight: "800" },
});
