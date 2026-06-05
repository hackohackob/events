import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSessionStore } from "../security/session-store";
import { useMapStore } from "./map-store";
import { assignDestination, setMyStatus } from "../ui/event-actions";
import { debugLog } from "../debug/debug-log";

type Status = "available" | "rest" | "going_to";

const STATUS_META: Record<Status, { label: string; color: string; bg: string; icon: keyof typeof Feather.glyphMap }> = {
  available: { label: "Available", color: "#34d399", bg: "rgba(6, 24, 20, 0.95)", icon: "check-circle" },
  going_to:  { label: "Going to",  color: "#fbbf24", bg: "rgba(31, 22, 6, 0.95)", icon: "navigation" },
  rest:      { label: "Rest",      color: "#a78bfa", bg: "rgba(22, 16, 38, 0.95)", icon: "moon" },
};

/**
 * Left-side status control mirroring the right-hand map controls. The collapsed
 * button is coloured by the medic's current status (green / amber / purple) and
 * expands to let them switch between Available and Rest (Going-to is automatic).
 */
export function MedicStatusControl() {
  const role = useSessionStore((s) => s.role);
  const myId = useSessionStore((s) => s.userId);
  const markers = useMapStore((s) => s.markers);
  const setMarkers = useMapStore((s) => s.setMarkers);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const mine = markers.find((m) => m.id === myId && m.type === "paramedic");
  const status = (mine?.status as Status | undefined) ?? "available";
  const meta = STATUS_META[status];
  const isMedic = role === "medic" || role === "paramedic";

  const patchMine = (patch: Record<string, unknown>) => {
    const current = useMapStore.getState().markers;
    setMarkers(current.map((m) => (m.id === myId && m.type === "paramedic" ? { ...m, ...patch } : m)));
  };

  const choose = async (next: "available" | "rest") => {
    setOpen(false);
    if (busy || status === next) return;
    setBusy(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    patchMine({ status: next, destination: null });
    try {
      await setMyStatus(next);
    } catch (err) {
      debugLog("api", "error", "set status failed", String(err));
    } finally {
      setBusy(false);
    }
  };

  const stopGoing = async () => {
    setOpen(false);
    if (busy) return;
    setBusy(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    patchMine({ status: "available", destination: null });
    try {
      await assignDestination(null);
    } catch (err) {
      debugLog("api", "error", "clear destination failed", String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!isMedic || !mine) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {/* Collapsed status button */}
      <Pressable
        style={[styles.button, { backgroundColor: meta.bg, borderColor: `${meta.color}88` }]}
        onPress={() => setOpen((v) => !v)}
      >
        {busy ? (
          <ActivityIndicator size="small" color={meta.color} />
        ) : (
          <Feather name={meta.icon} size={20} color={meta.color} />
        )}
        <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
      </Pressable>

      {/* Expanded chooser */}
      {open ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>MY STATUS</Text>

          {status === "going_to" ? (
            <View style={styles.goingBox}>
              <Feather name="navigation" size={13} color="#fbbf24" />
              <Text style={styles.goingText} numberOfLines={1}>
                {mine.destination?.label ?? "En route"}
              </Text>
            </View>
          ) : null}

          {(["available", "rest"] as const).map((opt) => {
            const m = STATUS_META[opt];
            const active = status === opt;
            return (
              <Pressable
                key={opt}
                style={[styles.option, active && { backgroundColor: `${m.color}1f`, borderColor: `${m.color}66` }]}
                onPress={() => choose(opt)}
              >
                <Feather name={m.icon} size={16} color={m.color} />
                <Text style={[styles.optionText, active && { color: m.color }]}>{m.label}</Text>
                {active ? <Feather name="check" size={15} color={m.color} style={{ marginLeft: "auto" }} /> : null}
              </Pressable>
            );
          })}

          {status === "going_to" ? (
            <Pressable style={[styles.option, styles.stopOption]} onPress={stopGoing}>
              <Feather name="x-circle" size={16} color="#f87171" />
              <Text style={[styles.optionText, { color: "#f87171" }]}>Stop going</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    top: 70,
    zIndex: 30,
    alignItems: "flex-start",
  },
  button: {
    width: 46,
    height: 46,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  statusDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(2,11,24,0.9)",
  },
  panel: {
    marginTop: 8,
    width: 184,
    backgroundColor: "rgba(8, 15, 28, 0.97)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.18)",
    padding: 8,
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  panelTitle: { color: "#64748b", fontSize: 10, fontWeight: "800", letterSpacing: 1, paddingHorizontal: 4, paddingTop: 2 },
  goingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(245,158,11,0.1)",
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  goingText: { color: "#fcd34d", fontSize: 12, fontWeight: "700", flex: 1 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  stopOption: { backgroundColor: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.25)" },
  optionText: { color: "#cbd5e1", fontSize: 13, fontWeight: "800" },
});
