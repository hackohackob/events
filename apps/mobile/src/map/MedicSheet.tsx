import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { DEFAULT_VEHICLE_TYPE, VEHICLE_TYPE_META, VEHICLE_TYPES, type VehicleType } from "@events/contracts";
import { useRosterStore, type RosterMedic } from "../security/roster-store";
import { useSessionStore } from "../security/session-store";
import { setMedicVehicleType } from "../ui/event-actions";
import { useMapStore } from "./map-store";
import { debugLog } from "../debug/debug-log";
import { freshnessColor, freshnessLabel } from "./freshness";

/** The subset of a map marker a medic detail sheet needs. */
export interface MedicSheetMarker {
  id: string;
  label: string;
  name?: string;
  lat: number;
  lng: number;
  vehicle?: string;
  vehicleType?: VehicleType;
  accuracy?: number;
  battery?: number;
  charging?: boolean;
  lastSeenAt?: string;
  status?: string;
  destination?: { lat: number; lng: number; label: string } | null;
  route?: { distanceMeters?: number; durationMs?: number } | null;
}

interface Props {
  marker: MedicSheetMarker;
  rosterEntry?: RosterMedic;
  onClose: () => void;
  onClearDestination: () => void;
}

const STATUS_META: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap; emoji?: string }> = {
  available:  { label: "Available",  color: "#34d399", icon: "check-circle" },
  stationary: { label: "Stationary", color: "#34d399", icon: "anchor" },
  sweeper:    { label: "Sweeper",    color: "#38bdf8", icon: "wind", emoji: "🧹" },
  going_to:   { label: "En route",   color: "#fbbf24", icon: "navigation" },
  rest:       { label: "Rest",       color: "#a78bfa", icon: "moon" },
};

function initials(label: string): string {
  return label
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Battery colour: healthy green, warning amber, critical red; charging always green. */
function batteryColor(level: number, charging?: boolean): string {
  if (charging) return "#34d399";
  if (level <= 0.2) return "#f87171";
  if (level <= 0.45) return "#fbbf24";
  return "#34d399";
}

/**
 * Medic detail drawer — hero header with live status, telemetry cards
 * (battery with charging state, GPS, freshness), destination card, and skills.
 */
export function MedicSheet({ marker, rosterEntry, onClose, onClearDestination }: Props) {
  const status = STATUS_META[marker.status ?? "available"] ?? STATUS_META.available;
  const ageMs = marker.lastSeenAt ? Date.now() - new Date(marker.lastSeenAt).getTime() : undefined;
  const freshColor = freshnessColor(ageMs);
  const isCoordinator = rosterEntry?.type === "coordinator";
  const skills = useMemo(
    () => [...(rosterEntry?.skills ?? []), ...(rosterEntry?.capabilities ?? [])],
    [rosterEntry],
  );

  // ── Vehicle (editable live) ───────────────────────────────────────────────
  // A coordinator can re-vehicle anyone mid-event; everyone else only
  // themselves. The server enforces the same rule — this only hides the UI.
  const amCoordinator = useRosterStore((s) => s.amCoordinator);
  const myId = useSessionStore((s) => s.userId);
  const canEditVehicle = amCoordinator || marker.id === myId;
  const vehicleType = marker.vehicleType ?? rosterEntry?.vehicleType ?? DEFAULT_VEHICLE_TYPE;
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [savingVehicle, setSavingVehicle] = useState<VehicleType | null>(null);

  const chooseVehicle = (next: VehicleType) => {
    if (next === vehicleType) {
      setVehicleOpen(false);
      return;
    }
    void Haptics.selectionAsync();
    setSavingVehicle(next);
    const previous = vehicleType;
    // Optimistic on both stores, rolled back if the server refuses.
    const patch = (value: VehicleType) => {
      useRosterStore.getState().setVehicleType(marker.id, value);
      const markers = useMapStore.getState().markers;
      useMapStore.getState().setMarkers(
        markers.map((m) => (m.id === marker.id ? { ...m, vehicleType: value } : m)),
      );
    };
    patch(next);
    void setMedicVehicleType(next, marker.id)
      .then(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setVehicleOpen(false);
      })
      .catch((err) => {
        debugLog("api", "error", "set vehicle failed", String(err));
        patch(previous);
        Alert.alert("Couldn't change vehicle", "The change was not saved. Please try again.");
      })
      .finally(() => setSavingVehicle(null));
  };

  const battery = marker.battery;
  const batColor = battery != null ? batteryColor(battery, marker.charging) : "#64748b";

  return (
    <View style={styles.root}>
      {/* Status accent hairline */}
      <View style={[styles.accent, { backgroundColor: status.color }]} />

      {/* ── Hero header ── */}
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: `${status.color}1f`, borderColor: `${status.color}55` }]}>
          <Text style={[styles.avatarText, { color: status.color }]} allowFontScaling={false}>
            {initials(marker.name ?? marker.label)}
          </Text>
          {/* Freshness dot anchored to the avatar */}
          <View style={[styles.freshDot, { backgroundColor: freshColor }]} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.name} numberOfLines={1}>{marker.name ?? marker.label}</Text>
          <View style={styles.chipsRow}>
            <View style={[styles.statusPill, { backgroundColor: `${status.color}1c`, borderColor: `${status.color}55` }]}>
              {status.emoji ? (
                <Text style={styles.statusEmoji} allowFontScaling={false}>{status.emoji}</Text>
              ) : (
                <Feather name={status.icon} size={11} color={status.color} />
              )}
              <Text style={[styles.statusPillText, { color: status.color }]}>{status.label}</Text>
            </View>
            <Text style={styles.roleText}>{isCoordinator ? "Coordinator" : "Medic"}</Text>
          </View>
        </View>
        <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
          <Feather name="x" size={18} color="#94a3b8" />
        </Pressable>
      </View>

      <BottomSheetScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        {/* ── Telemetry cards ── */}
        <View style={styles.cardsRow}>
          {/* Battery */}
          <View style={styles.card}>
            <View style={styles.cardLabelRow}>
              <Feather name={marker.charging ? "zap" : "battery"} size={11} color={marker.charging ? "#34d399" : "#64748b"} />
              <Text style={styles.cardLabel}>BATTERY</Text>
            </View>
            {battery != null ? (
              <>
                <View style={styles.cardValueRow}>
                  <Text style={[styles.cardValue, { color: batColor }]}>{Math.round(battery * 100)}%</Text>
                  {marker.charging ? (
                    <View style={styles.chargingChip}>
                      <Feather name="zap" size={9} color="#04121f" />
                      <Text style={styles.chargingChipText}>Charging</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.batteryTrack}>
                  <View style={[styles.batteryFill, { width: `${Math.round(battery * 100)}%`, backgroundColor: batColor }]} />
                </View>
              </>
            ) : (
              <Text style={styles.cardValueMuted}>—</Text>
            )}
          </View>

          {/* GPS */}
          <View style={styles.card}>
            <View style={styles.cardLabelRow}>
              <Feather name="crosshair" size={11} color="#64748b" />
              <Text style={styles.cardLabel}>GPS</Text>
            </View>
            <Text style={styles.cardValue}>
              {marker.accuracy != null ? `±${Math.round(marker.accuracy)} m` : "—"}
            </Text>
            <Text style={styles.cardSub} numberOfLines={1}>
              {marker.lat.toFixed(5)}, {marker.lng.toFixed(5)}
            </Text>
          </View>
        </View>

        <View style={styles.cardsRow}>
          {/* Last seen */}
          <View style={styles.card}>
            <View style={styles.cardLabelRow}>
              <Feather name="clock" size={11} color="#64748b" />
              <Text style={styles.cardLabel}>LAST SEEN</Text>
            </View>
            <Text style={[styles.cardValue, { color: freshColor }]}>
              {ageMs === undefined ? "Unknown" : freshnessLabel(ageMs)}
            </Text>
          </View>

          {/* Vehicle — tappable when I'm allowed to change it. What a medic
              travels with decides every ETA quoted for them, and it changes
              mid-event (bike goes flat, the 4×4 finally arrives). */}
          <Pressable
            style={[styles.card, canEditVehicle && styles.cardEditable]}
            onPress={canEditVehicle ? () => setVehicleOpen((v) => !v) : undefined}
            disabled={!canEditVehicle}
          >
            <View style={styles.cardLabelRow}>
              <Feather name="truck" size={11} color="#64748b" />
              <Text style={styles.cardLabel}>VEHICLE</Text>
              {canEditVehicle ? (
                <Feather
                  name={vehicleOpen ? "chevron-up" : "chevron-down"}
                  size={12}
                  color="#7dd3fc"
                  style={styles.cardLabelChevron}
                />
              ) : null}
            </View>
            <View style={styles.vehicleValueRow}>
              <Text style={styles.vehicleGlyph} allowFontScaling={false}>
                {VEHICLE_TYPE_META[vehicleType].icon}
              </Text>
              <Text style={styles.cardValue} numberOfLines={1}>
                {VEHICLE_TYPE_META[vehicleType].label}
              </Text>
            </View>
            <Text style={styles.cardSub} numberOfLines={1}>
              {marker.vehicle ?? rosterEntry?.vehicle ?? rosterEntry?.unit ?? "Mobile unit"}
            </Text>
          </Pressable>
        </View>

        {/* Vehicle picker — inline so the change takes two taps in the field. */}
        {vehicleOpen && canEditVehicle ? (
          <View style={styles.vehiclePicker}>
            {VEHICLE_TYPES.map((type) => {
              const meta = VEHICLE_TYPE_META[type];
              const active = type === vehicleType;
              return (
                <Pressable
                  key={type}
                  style={[styles.vehicleOption, active && styles.vehicleOptionActive]}
                  onPress={() => chooseVehicle(type)}
                  disabled={savingVehicle != null}
                >
                  <Text style={styles.vehicleOptionGlyph} allowFontScaling={false}>{meta.icon}</Text>
                  <Text style={[styles.vehicleOptionText, active && styles.vehicleOptionTextActive]} numberOfLines={1}>
                    {meta.label}
                  </Text>
                  {savingVehicle === type ? <ActivityIndicator size="small" color="#7dd3fc" /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* ── En-route card ── */}
        {marker.destination || marker.route ? (
          <View style={styles.destCard}>
            <View style={styles.destHeader}>
              <Feather name="navigation" size={13} color="#fbbf24" />
              <Text style={styles.destTitle}>HEADING TO</Text>
            </View>
            {marker.destination?.label ? (
              <Text style={styles.destLabel} numberOfLines={2}>{marker.destination.label}</Text>
            ) : null}
            {marker.route?.distanceMeters != null && marker.route?.durationMs != null ? (
              <Text style={styles.destMeta}>
                {(marker.route.distanceMeters / 1000).toFixed(1)} km · {Math.max(1, Math.round(marker.route.durationMs / 60000))} min
              </Text>
            ) : null}
            <Pressable style={styles.clearBtn} onPress={onClearDestination}>
              <Feather name="x-circle" size={14} color="#fca5a5" />
              <Text style={styles.clearBtnText}>Clear destination</Text>
            </Pressable>
          </View>
        ) : null}

        {/* ── Skills ── */}
        {skills.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>SKILLS & EQUIPMENT</Text>
            <View style={styles.skillsWrap}>
              {skills.map((skill) => (
                <View key={skill} style={styles.skillChip}>
                  <Text style={styles.skillChipText}>{skill}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </BottomSheetScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  accent: { height: 3, borderRadius: 2, marginHorizontal: 20, marginBottom: 10, opacity: 0.85 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(148,163,184,0.18)",
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 17, fontWeight: "900", letterSpacing: 0.5 },
  freshDot: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#0b1220",
  },
  headerText: { flex: 1, minWidth: 0 },
  name: { color: "#EFF6FF", fontSize: 19, fontWeight: "900", letterSpacing: 0.2 },
  chipsRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 5 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 3.5,
    paddingHorizontal: 9,
  },
  statusPillText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.4 },
  statusEmoji: { fontSize: 11, lineHeight: 13, includeFontPadding: false },
  roleText: { color: "#64748b", fontSize: 11.5, fontWeight: "700" },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },

  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 60, gap: 10 },

  cardsRow: { flexDirection: "row", gap: 10 },
  card: {
    flex: 1,
    backgroundColor: "#101d32",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.1)",
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 5,
  },
  cardEditable: { borderColor: "rgba(125,211,252,0.28)" },
  cardLabelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  cardLabel: { color: "#4A5F7A", fontSize: 9.5, fontWeight: "900", letterSpacing: 1.1 },
  cardLabelChevron: { marginLeft: "auto" },
  vehicleValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  vehicleGlyph: { fontSize: 15, lineHeight: 19, includeFontPadding: false },
  vehiclePicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    backgroundColor: "rgba(56,189,248,0.05)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.2)",
    padding: 10,
  },
  vehicleOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  vehicleOptionActive: { borderColor: "#38bdf8", backgroundColor: "rgba(56,189,248,0.16)" },
  vehicleOptionGlyph: { fontSize: 13, lineHeight: 16, includeFontPadding: false },
  vehicleOptionText: { color: "#c3d3e6", fontSize: 12.5, fontWeight: "800" },
  vehicleOptionTextActive: { color: "#e0f2fe" },
  cardValueRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  cardValue: { color: "#E2E8F0", fontSize: 16, fontWeight: "900", letterSpacing: 0.2 },
  cardValueMuted: { color: "#475569", fontSize: 16, fontWeight: "900" },
  cardSub: { color: "#64748b", fontSize: 10.5, fontWeight: "600" },
  chargingChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#34d399",
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  chargingChipText: { color: "#04121f", fontSize: 9, fontWeight: "900", letterSpacing: 0.3 },
  batteryTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(148,163,184,0.15)",
    overflow: "hidden",
    marginTop: 2,
  },
  batteryFill: { height: "100%", borderRadius: 3 },

  destCard: {
    backgroundColor: "rgba(245,158,11,0.08)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.28)",
    padding: 14,
    gap: 6,
    marginTop: 2,
  },
  destHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  destTitle: { color: "#fbbf24", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  destLabel: { color: "#fde68a", fontSize: 15, fontWeight: "800" },
  destMeta: { color: "#d6bd7a", fontSize: 12, fontWeight: "700" },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    backgroundColor: "rgba(239,68,68,0.1)",
    paddingVertical: 10,
  },
  clearBtnText: { color: "#fca5a5", fontSize: 13, fontWeight: "800" },

  sectionLabel: {
    color: "#4A5F7A",
    fontSize: 9.5,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginTop: 8,
  },
  skillsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  skillChip: {
    backgroundColor: "rgba(56,189,248,0.1)",
    borderColor: "rgba(56,189,248,0.3)",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  skillChipText: { color: "#7dd3fc", fontSize: 11.5, fontWeight: "800" },
});
