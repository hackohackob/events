import React, { useEffect, useMemo, useRef } from "react";
import { Alert, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMapStore } from "../map/map-store";
import { useSessionStore } from "../security/session-store";
import { useLocationStatus } from "../debug/location-status";
import { standDownIncident } from "../ui/event-actions";
import { debugLog } from "../debug/debug-log";
import { useNavStore } from "./nav-store";
import { distanceMeters } from "./geo";

function isClosed(status?: string): boolean {
  return status === "resolved" || status === "closed" || status === "archived";
}

function formatDistance(meters: number): string {
  if (meters < 950) return `${Math.round(meters / 10) * 10} m away`;
  return `${(meters / 1000).toFixed(meters < 9500 ? 1 : 0)} km away`;
}

/**
 * Card shown to a medic who has been assigned to an incident, below the top
 * bar. Two rows: an identity row (pulsing beacon, kicker, incident name and
 * live distance, stand-down ✕) and a full-width "Navigate" action. Tapping
 * "Navigate" starts the navigation flow to the incident (already registered as
 * responding, so the route is tagged to the incident). Hidden once the medic
 * is already in a navigation flow.
 */
export function AssignedIncidentBanner() {
  const markers = useMapStore((s) => s.markers);
  const myId = useSessionStore((s) => s.userId);
  const navPhase = useNavStore((s) => s.phase);
  const myFix = useLocationStatus((s) => s.lastFix);
  const pulse = useRef(new Animated.Value(0)).current;

  // The (open) incident I'm assigned to, if any.
  const incident = useMemo(
    () =>
      markers.find(
        (m) =>
          m.type === "incident" &&
          !isClosed(m.status) &&
          (m.respondingParamedicIds ?? []).includes(myId ?? "__none__"),
      ),
    [markers, myId],
  );

  const visible = Boolean(incident) && navPhase === "idle";

  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  if (!visible || !incident) return null;

  const label = incident.name ?? incident.label ?? "incident";
  const distance =
    myFix != null
      ? formatDistance(distanceMeters({ lat: myFix.lat, lng: myFix.lng }, { lat: incident.lat, lng: incident.lng }))
      : null;

  const unassign = () => {
    Alert.alert(
      "Stand down?",
      `Remove yourself from "${label}"? You'll no longer be responding to this incident.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Stand down",
          style: "destructive",
          onPress: () => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            // Optimistically drop myself from the incident's responders.
            const current = useMapStore.getState().markers;
            useMapStore.getState().setMarkers(
              current.map((m) =>
                m.id === incident.id && m.type === "incident"
                  ? { ...m, respondingParamedicIds: (m.respondingParamedicIds ?? []).filter((id) => id !== myId) }
                  : m,
              ),
            );
            void standDownIncident(incident.id).catch((err) => debugLog("api", "error", "stand down failed", String(err)));
          },
        },
      ],
    );
  };

  const borderColor = pulse.interpolate({ inputRange: [0, 1], outputRange: ["rgba(239,68,68,0.4)", "rgba(248,113,113,0.95)"] });
  const shadowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.6] });
  const beaconOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.0, 0.45] });
  const beaconScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.5] });

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Animated.View style={[styles.card, { borderColor, shadowOpacity, shadowColor: "#ef4444" }]}>
        {/* Identity row */}
        <View style={styles.headerRow}>
          <View style={styles.iconWrap}>
            <Animated.View style={[styles.beacon, { opacity: beaconOpacity, transform: [{ scale: beaconScale }] }]} />
            <Feather name="alert-circle" size={20} color="#fca5a5" />
          </View>
          <View style={styles.textWrap}>
            <Text style={styles.kicker} numberOfLines={1}>ASSIGNED TO INCIDENT</Text>
            <Text style={styles.title} numberOfLines={1}>{label}</Text>
            {distance ? <Text style={styles.distance} numberOfLines={1}>{distance}</Text> : null}
          </View>
          <Pressable
            style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
            onPress={unassign}
            hitSlop={8}
          >
            <Feather name="x" size={15} color="#fca5a5" />
          </Pressable>
        </View>

        {/* Action row */}
        <Pressable
          style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            useNavStore.getState().openTransport(
              { lat: incident.lat, lng: incident.lng, label },
              incident.id,
            );
          }}
        >
          <Feather name="navigation" size={16} color="#04121f" />
          <Text style={styles.navText}>Navigate to incident</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Below the top bar. The medic status button is hidden while assigned (the
  // status is locked to "responding"), so the card takes over its slot and
  // spans from the left edge to the right-hand map-control column.
  wrap: { position: "absolute", top: 70, left: 12, right: 66, zIndex: 35 },
  card: {
    backgroundColor: "rgba(18,9,11,0.97)",
    borderRadius: 22,
    borderWidth: 1.5,
    padding: 14,
    gap: 12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 2 },
    elevation: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(239,68,68,0.16)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  beacon: {
    position: "absolute",
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#ef4444",
  },
  textWrap: { flex: 1, minWidth: 0 },
  kicker: { color: "#f87171", fontSize: 10, fontWeight: "900", letterSpacing: 1.6 },
  title: { color: "#fff1f1", fontSize: 17.5, fontWeight: "900", marginTop: 2 },
  distance: { color: "#e7a4a4", fontSize: 12.5, fontWeight: "700", marginTop: 1 },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.28)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  closeButtonPressed: { backgroundColor: "rgba(239,68,68,0.3)" },
  navButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#34d399",
    borderRadius: 15,
    paddingVertical: 14,
    shadowColor: "#34d399",
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  navButtonPressed: { backgroundColor: "#2bb38a" },
  navText: { color: "#04121f", fontSize: 15.5, fontWeight: "900", letterSpacing: 0.2 },
});
