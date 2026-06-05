import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSessionStore } from "../security/session-store";
import { useRosterStore } from "../security/roster-store";
import { useMapStore } from "./map-store";
import {
  assignDestination,
  assignIncidentResponder,
  respondToIncident,
  standDownIncident,
  type Destination,
} from "../ui/event-actions";
import { debugLog } from "../debug/debug-log";

/**
 * Action bar shown on a POI / incident marker. Lets a medic send themselves to
 * the point ("Go here"), or — if they are a coordinator — dispatch another medic.
 * When `incidentId` is provided, dispatching also registers the medic on the
 * incident's responder list so it shows under RESPONDERS.
 */
export function AssignDestinationBar({
  destination,
  incidentId,
}: {
  destination: Destination;
  incidentId?: string;
}) {
  const role = useSessionStore((s) => s.role);
  const myId = useSessionStore((s) => s.userId);
  const markers = useMapStore((s) => s.markers);
  const setMarkers = useMapStore((s) => s.setMarkers);
  const amCoordinator = useRosterStore((s) => s.amCoordinator);
  const roster = useRosterStore((s) => s.medics);
  const loadRoster = useRosterStore((s) => s.load);
  const [picking, setPicking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!useRosterStore.getState().loaded) void loadRoster();
  }, [loadRoster]);

  const isMedic = role === "medic" || role === "paramedic";
  if (!isMedic) return null;

  const mine = markers.find((m) => m.id === myId && m.type === "paramedic");
  const goingHere = mine?.destination?.lat === destination.lat && mine?.destination?.lng === destination.lng;

  // Optimistically add/remove a medic from the incident's responder list so the
  // RESPONDERS tab reflects the change instantly (the socket confirms shortly after).
  const setIncidentResponder = (medicId: string, add: boolean) => {
    if (!incidentId) return;
    const current = useMapStore.getState().markers;
    setMarkers(
      current.map((m) => {
        if (m.id !== incidentId || m.type !== "incident") return m;
        const existing = m.respondingParamedicIds ?? [];
        const next = add
          ? existing.includes(medicId)
            ? existing
            : [...existing, medicId]
          : existing.filter((id) => id !== medicId);
        return { ...m, respondingParamedicIds: next };
      }),
    );
  };

  const dispatch = async (medicId: string) => {
    setBusyId(medicId);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // optimistic for self
    if (medicId === myId) {
      const current = useMapStore.getState().markers;
      setMarkers(current.map((m) => (m.id === myId && m.type === "paramedic" ? { ...m, status: "going_to", destination } : m)));
    }
    setIncidentResponder(medicId, true);
    try {
      await assignDestination(destination, medicId);
      // Register the medic on the incident so they appear under RESPONDERS.
      if (incidentId) {
        if (medicId === myId) await respondToIncident(incidentId);
        else await assignIncidentResponder(incidentId, medicId);
      }
      setPicking(false);
    } catch (err) {
      setIncidentResponder(medicId, false); // roll back on failure
      debugLog("api", "error", "assign failed", String(err));
    } finally {
      setBusyId(null);
    }
  };

  const clearMine = async () => {
    setBusyId(myId);
    const current = useMapStore.getState().markers;
    setMarkers(current.map((m) => (m.id === myId && m.type === "paramedic" ? { ...m, status: "available", destination: null } : m)));
    setIncidentResponder(myId ?? "", false);
    try {
      await assignDestination(null);
      if (incidentId) await standDownIncident(incidentId);
    } catch (err) {
      debugLog("api", "error", "clear failed", String(err));
    } finally {
      setBusyId(null);
    }
  };

  // Online other medics a coordinator can dispatch.
  const others = roster.filter((m) => m.id !== myId);

  return (
    <View style={styles.wrap}>
      {goingHere ? (
        <Pressable style={[styles.btn, styles.clearBtn]} onPress={clearMine}>
          <Text style={styles.clearBtnText}>✓ You're going here — Stop</Text>
        </Pressable>
      ) : (
        <Pressable style={[styles.btn, styles.goBtn]} onPress={() => dispatch(myId ?? "")} disabled={busyId === myId}>
          <Text style={styles.goBtnText}>🚑 Go here</Text>
        </Pressable>
      )}

      {amCoordinator ? (
        <>
          <Pressable style={[styles.btn, styles.assignBtn]} onPress={() => setPicking((v) => !v)}>
            <Text style={styles.assignBtnText}>{picking ? "Cancel" : "Assign medic…"}</Text>
          </Pressable>
          {picking ? (
            <View style={styles.pickList}>
              {others.length === 0 ? (
                <Text style={styles.pickEmpty}>No other medics on the roster.</Text>
              ) : (
                others.map((m) => (
                  <Pressable key={m.id} style={styles.pickRow} onPress={() => dispatch(m.id)} disabled={busyId === m.id}>
                    <Text style={styles.pickName}>{m.name}</Text>
                    <Text style={styles.pickSend}>{busyId === m.id ? "…" : "Send →"}</Text>
                  </Pressable>
                ))
              )}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 10 },
  btn: { paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  goBtn: { backgroundColor: "#f59e0b" },
  goBtnText: { color: "#1a1206", fontSize: 14, fontWeight: "900" },
  clearBtn: { backgroundColor: "rgba(239,68,68,0.14)", borderWidth: 1, borderColor: "rgba(239,68,68,0.35)" },
  clearBtnText: { color: "#f87171", fontSize: 13, fontWeight: "800" },
  assignBtn: { backgroundColor: "rgba(59,130,246,0.14)", borderWidth: 1, borderColor: "rgba(59,130,246,0.35)" },
  assignBtnText: { color: "#93c5fd", fontSize: 13, fontWeight: "800" },
  pickList: { gap: 4, backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 6 },
  pickEmpty: { color: "#64748b", fontSize: 12, padding: 8, textAlign: "center" },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  pickName: { color: "#e2e8f0", fontSize: 13, fontWeight: "700" },
  pickSend: { color: "#60a5fa", fontSize: 12, fontWeight: "800" },
});
