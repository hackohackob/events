import React, { useCallback, useEffect, useState } from "react";
import { Alert, AppState, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { DEFAULT_VEHICLE_TYPE, VEHICLE_TYPE_META, VEHICLE_TYPES, type VehicleType } from "@events/contracts";
import {
  KM_MARKER_INTERVAL_OPTIONS,
  LOCATION_INTERVAL_OPTIONS,
  STATIONARY_INTERVAL_MS,
  useSettingsStore,
} from "./settings-store";
import { startLocationLoop } from "../location/location-tracker";
import { isDndBypassGranted, openDndAccessSettings } from "../notifications/dnd-access";
import { PttBridgeSection } from "../ptt/PttBridgeSection";
import { useRosterStore } from "../security/roster-store";
import { useSessionStore } from "../security/session-store";
import { setMedicVehicleType } from "../ui/event-actions";
import { debugLog } from "../debug/debug-log";

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  // Only coordinators change what the event puts on the air.
  // Coordinator status is a property of the USER, resolved live from the roster
  // (`type`, which the backend derives from users.role). The session role comes
  // from the join call and is just "medic" for a coordinator who joined as one
  // — keying off it hid the coordinator-only sections from every coordinator.
  const isCoordinator = useRosterStore((s) => s.amCoordinator);
  const locationIntervalMs = useSettingsStore((s) => s.locationIntervalMs);
  const setLocationIntervalMs = useSettingsStore((s) => s.setLocationIntervalMs);
  const [intervalOpen, setIntervalOpen] = useState(false);
  const [kmIntervalOpen, setKmIntervalOpen] = useState(false);
  const trackOffsetEnabled = useSettingsStore((s) => s.trackOffsetEnabled);
  const setTrackOffsetEnabled = useSettingsStore((s) => s.setTrackOffsetEnabled);
  const trackGradientEnabled = useSettingsStore((s) => s.trackGradientEnabled);
  const setTrackGradientEnabled = useSettingsStore((s) => s.setTrackGradientEnabled);
  const kmMarkerIntervalKm = useSettingsStore((s) => s.kmMarkerIntervalKm);
  const setKmMarkerIntervalKm = useSettingsStore((s) => s.setKmMarkerIntervalKm);
  const showArchived = useSettingsStore((s) => s.showArchived);
  const setShowArchived = useSettingsStore((s) => s.setShowArchived);
  // A stationary medic is throttled to the stationary floor AND measured coarse —
  // say so, otherwise the picker looks broken ("I chose 1 min and it sends every
  // 7") and their own dot drifting 100 m looks like a bug.
  const stationaryMode = useSettingsStore((s) => s.stationaryMode);
  // What tracking is actually running at, which is what the picker must show.
  const effectiveIntervalMs = stationaryMode
    ? Math.max(locationIntervalMs, STATIONARY_INTERVAL_MS)
    : locationIntervalMs;

  const pickInterval = (ms: number) => {
    if (ms === locationIntervalMs) return;
    setLocationIntervalMs(ms);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Restart the background updates so the new cadence takes effect immediately.
    void startLocationLoop();
  };

  // ── My vehicle ─────────────────────────────────────────────────────────────
  // Self-service so a medic who swaps a bike for a 4×4 mid-event fixes their own
  // ETAs; a coordinator can also change it from the medic's map sheet.
  const myId = useSessionStore((s) => s.userId);
  const myVehicleType =
    useRosterStore((s) => s.medics.find((m) => m.id === myId)?.vehicleType) ?? DEFAULT_VEHICLE_TYPE;
  const [vehicleOpen, setVehicleOpen] = useState(false);

  const pickVehicle = (type: VehicleType) => {
    setVehicleOpen(false);
    if (type === myVehicleType || !myId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    useRosterStore.getState().setVehicleType(myId, type);
    void setMedicVehicleType(type).catch((err) => {
      debugLog("api", "error", "set my vehicle failed", String(err));
      useRosterStore.getState().setVehicleType(myId, myVehicleType);
      Alert.alert("Couldn't change vehicle", "The change was not saved. Please try again.");
    });
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
            {/* Shows what tracking is ACTUALLY doing, not what was picked. While
                On post the floor overrides the choice, and leaving the button on
                "3 min" while the app reported every 7 read as a broken setting. */}
            <Text style={styles.dropdownValue}>
              {LOCATION_INTERVAL_OPTIONS.find((o) => o.ms === effectiveIntervalMs)?.label ?? "—"}
            </Text>
            {stationaryMode ? (
              <View style={styles.forcedChip}>
                <Feather name="anchor" size={9} color="#04121f" />
                <Text style={styles.forcedChipText} allowFontScaling={false}>ON POST</Text>
              </View>
            ) : null}
            <Feather name={intervalOpen ? "chevron-up" : "chevron-down"} size={18} color="#7e90a8" />
          </Pressable>
          {intervalOpen ? (
            <View style={styles.dropdownMenu}>
              {LOCATION_INTERVAL_OPTIONS.map((opt) => {
                const active = opt.ms === effectiveIntervalMs;
                // Anything under the floor cannot take effect while On post, so
                // it is shown as unavailable rather than tappable-but-ignored.
                const blocked = stationaryMode && opt.ms < STATIONARY_INTERVAL_MS;
                return (
                  <Pressable
                    key={opt.ms}
                    disabled={blocked}
                    onPress={() => {
                      pickInterval(opt.ms);
                      setIntervalOpen(false);
                    }}
                    style={[styles.dropdownItem, active && styles.dropdownItemActive]}
                  >
                    <Text
                      style={[
                        styles.dropdownItemText,
                        active && styles.dropdownItemTextActive,
                        blocked && styles.dropdownItemTextBlocked,
                      ]}
                    >
                      {opt.label}
                    </Text>
                    {active ? <Feather name="check" size={15} color="#34d399" /> : null}
                    {blocked ? <Feather name="lock" size={12} color="#475569" /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {/* The stationary trade-off is deliberately spelled out: it costs
              accuracy as well as cadence, and a medic seeing their own dot drift
              ~100 m should be able to find out why without asking. */}
          <Text style={styles.note}>
            {stationaryMode
              ? "You are On post — location is held to 7 min and measured to about 100 m, which uses far less battery. Faster options unlock when you leave On post; being dispatched or starting navigation does that automatically."
              : "Lower frequencies save battery. A persistent notification keeps tracking alive in the background."}
          </Text>
        </View>

        {/* ── Push-to-talk bridges ────────────────────────────── */}
        {isCoordinator ? (
          <>
            <Text style={styles.sectionLabel}>PUSH-TO-TALK</Text>
            <PttBridgeSection />
          </>
        ) : null}

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
          <View style={styles.rowDivider}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Km marker spacing</Text>
              <Text style={styles.rowSub}>
                How far apart the km chips are drawn along tracks. Toggle the chips themselves from the map layers menu.
              </Text>
            </View>
            {/* Compact dropdown, matching the update-frequency picker above. */}
            <Pressable
              style={styles.dropdownButton}
              onPress={() => {
                void Haptics.selectionAsync();
                setKmIntervalOpen((o) => !o);
              }}
            >
              <Text style={styles.dropdownValue}>{kmMarkerIntervalKm} km</Text>
              <Feather name={kmIntervalOpen ? "chevron-up" : "chevron-down"} size={18} color="#7e90a8" />
            </Pressable>
            {kmIntervalOpen ? (
              <View style={styles.dropdownMenu}>
                {KM_MARKER_INTERVAL_OPTIONS.map((km) => {
                  const active = km === kmMarkerIntervalKm;
                  return (
                    <Pressable
                      key={km}
                      onPress={() => {
                        setKmIntervalOpen(false);
                        if (active) return;
                        setKmMarkerIntervalKm(km);
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                      style={[styles.dropdownItem, active && styles.dropdownItemActive]}
                    >
                      <Text style={[styles.dropdownItemText, active && styles.dropdownItemTextActive]}>{km} km</Text>
                      {active ? <Feather name="check" size={15} color="#34d399" /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        </View>

        {/* ── Coordinator-only view options ───────────────────── */}
        {isCoordinator ? (
          <>
            <Text style={styles.sectionLabel}>COORDINATOR</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Show archived incidents & points</Text>
                  <Text style={styles.rowSub}>
                    Keep archived incidents and points on the map, dimmed, so you can review what was taken
                    down. Everyone else still sees only the live picture.
                  </Text>
                </View>
                <Switch
                  value={showArchived}
                  onValueChange={(v) => {
                    setShowArchived(v);
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  trackColor={{ false: "#1e293b", true: "#16a34a" }}
                  thumbColor="#f1f5f9"
                />
              </View>
            </View>
          </>
        ) : null}

        {/* ── My vehicle ──────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>MY VEHICLE</Text>
        <View style={styles.card}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>What you're travelling with</Text>
            <Text style={styles.rowSub}>
              Decides how the command centre estimates your time to an incident. A coordinator can change it too.
            </Text>
          </View>
          <Pressable
            style={styles.dropdownButton}
            onPress={() => {
              void Haptics.selectionAsync();
              setVehicleOpen((o) => !o);
            }}
          >
            <Text style={styles.dropdownValue}>
              {VEHICLE_TYPE_META[myVehicleType].icon}  {VEHICLE_TYPE_META[myVehicleType].label}
            </Text>
            <Feather name={vehicleOpen ? "chevron-up" : "chevron-down"} size={18} color="#7e90a8" />
          </Pressable>
          {vehicleOpen ? (
            <View style={styles.dropdownMenu}>
              {VEHICLE_TYPES.map((type) => {
                const active = type === myVehicleType;
                return (
                  <Pressable
                    key={type}
                    onPress={() => pickVehicle(type)}
                    style={[styles.dropdownItem, active && styles.dropdownItemActive]}
                  >
                    <Text style={[styles.dropdownItemText, active && styles.dropdownItemTextActive]}>
                      {VEHICLE_TYPE_META[type].icon}  {VEHICLE_TYPE_META[type].label}
                    </Text>
                    {active ? <Feather name="check" size={15} color="#34d399" /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
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
  dropdownValue: { color: "#e7eef8", fontSize: 14.5, fontWeight: "800", flex: 1 },
  forcedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#34d399",
    borderRadius: 999,
    paddingVertical: 2.5,
    paddingHorizontal: 8,
    marginRight: 8,
  },
  forcedChipText: { color: "#04121f", fontSize: 9.5, fontWeight: "900", letterSpacing: 0.4 },
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
  dropdownItemTextBlocked: { color: "#475569" },
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
