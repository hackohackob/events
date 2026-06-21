import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSessionStore } from "../security/session-store";
import { useRosterStore } from "../security/roster-store";
import { useMapStore } from "./map-store";
import { useNavStore } from "../navigation/nav-store";
import {
  assignDestination,
  assignIncidentResponder,
  respondToIncident,
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

  // Am I already on this incident's responder list? Used to swap the "mark me
  // assigned" button for a confirmed state.
  const amResponder = Boolean(
    incidentId &&
      myId &&
      markers
        .find((m) => m.id === incidentId && m.type === "incident")
        ?.respondingParamedicIds?.includes(myId),
  );
  const [markBusy, setMarkBusy] = useState(false);

  // Assign myself to this point WITHOUT starting navigation. For an incident
  // that means joining the responder list; for a plain POI it means taking the
  // point as my post (destination + "going_to" status), minus the turn-by-turn
  // navigation screen.
  const markAssigned = async () => {
    if (!myId || markBusy) return;
    setMarkBusy(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (incidentId) {
      setIncidentResponder(myId, true);
      try {
        await respondToIncident(incidentId);
      } catch (err) {
        setIncidentResponder(myId, false); // roll back on failure
        debugLog("api", "error", "mark assigned failed", String(err));
      } finally {
        setMarkBusy(false);
      }
      return;
    }
    // POI / plain point: take this point as my post without navigating.
    const current = useMapStore.getState().markers;
    setMarkers(current.map((m) => (m.id === myId && m.type === "paramedic" ? { ...m, status: "going_to", destination } : m)));
    try {
      await assignDestination(destination, myId);
    } catch (err) {
      const cur = useMapStore.getState().markers; // roll back on failure
      setMarkers(cur.map((m) => (m.id === myId && m.type === "paramedic" ? { ...m, status: "available", destination: null } : m)));
      debugLog("api", "error", "assign to point failed", String(err));
    } finally {
      setMarkBusy(false);
    }
  };

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

  // Online other medics a coordinator can dispatch.
  const others = roster.filter((m) => m.id !== myId);

  const navigateTo = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Navigating to an incident also registers me as responding (→ red/blue flash
    // for the whole team), and tags the broadcast route with the incident id.
    if (incidentId) {
      setIncidentResponder(myId ?? "", true);
      void respondToIncident(incidentId).catch(() => setIncidentResponder(myId ?? "", false));
    }
    useNavStore.getState().openTransport(
      { lat: destination.lat, lng: destination.lng, label: destination.label },
      incidentId ?? null,
    );
  };

  return (
    <View style={styles.wrap}>
      {goingHere ? (
        // Clearing your own destination is hidden for now (a coordinator / the
        // incident view still controls stand-down). Show status only.
        <View style={[styles.btn, styles.clearBtn]}>
          <Text style={styles.clearBtnText}>✓ You're going here</Text>
        </View>
      ) : (
        <Pressable style={[styles.btn, styles.goBtn]} onPress={navigateTo}>
          <Text style={styles.goBtnText}>🧭 Navigate</Text>
        </Pressable>
      )}

      {/* Assign myself to this point without starting navigation — for incidents
          (join responders) and for plain POIs (take the point as my post). */}
      {!goingHere ? (
        incidentId && amResponder ? (
          <View style={[styles.btn, styles.assignedBtn]}>
            <Text style={styles.assignedBtnText}>✓ You're assigned</Text>
          </View>
        ) : (
          <Pressable style={[styles.btn, styles.markBtn]} onPress={markAssigned} disabled={markBusy}>
            <Text style={styles.markBtnText}>
              {markBusy ? "…" : incidentId ? "✓ Mark me assigned" : "✓ Assign me here"}
            </Text>
          </Pressable>
        )
      ) : null}

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
  markBtn: { backgroundColor: "rgba(52,211,153,0.14)", borderWidth: 1, borderColor: "rgba(52,211,153,0.4)" },
  markBtnText: { color: "#34d399", fontSize: 13, fontWeight: "800" },
  assignedBtn: { backgroundColor: "rgba(52,211,153,0.12)", borderWidth: 1, borderColor: "rgba(52,211,153,0.3)" },
  assignedBtnText: { color: "#34d399", fontSize: 13, fontWeight: "800" },
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
