import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import NetInfo from "@react-native-community/netinfo";
import { JoinScreen } from "./auth/JoinScreen";
import { createIncident } from "./incidents/incident-api";
import { incidentQueue } from "./incidents/persistent-incident-queue";
import { useIncidentStore } from "./incidents/incident-store";
import { startLocationLoop } from "./location/location-tracker";
import { MapScreen } from "./map/MapScreen";
import { useSessionStore } from "./security/session-store";

async function flushIncidentQueue() {
  const ready = incidentQueue.listReady();
  let flushed = 0;
  for (const item of ready) {
    try {
      await createIncident(item.payload);
      await incidentQueue.remove(item.id);
      flushed++;
    } catch {
      await incidentQueue.markFailed(item.id);
    }
  }
  if (flushed > 0) {
    useIncidentStore.getState().showToast(`${flushed} incident report${flushed > 1 ? "s" : ""} sent`);
  }
}

function GlobalToast() {
  const toastMessage = useIncidentStore((s) => s.toastMessage);
  const translateY = useRef(new Animated.Value(80)).current;
  const prevMessage = useRef<string | null>(null);

  useEffect(() => {
    if (toastMessage && toastMessage !== prevMessage.current) {
      prevMessage.current = toastMessage;
      translateY.setValue(80);
      Animated.spring(translateY, {
        toValue: 0,
        damping: 26,
        mass: 1,
        stiffness: 300,
        useNativeDriver: true,
      }).start();
    } else if (!toastMessage && prevMessage.current) {
      prevMessage.current = null;
      Animated.spring(translateY, {
        toValue: 80,
        damping: 26,
        mass: 1,
        stiffness: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [toastMessage, translateY]);

  return (
    <Animated.View
      style={[styles.toast, { transform: [{ translateY }] }]}
      pointerEvents="none"
    >
      <View style={styles.toastInner}>
        <View style={styles.toastDot} />
        <Text style={styles.toastText}>{toastMessage ?? ""}</Text>
      </View>
    </Animated.View>
  );
}

export default function App() {
  const token = useSessionStore((state) => state.token);

  useEffect(() => {
    if (!token) return;

    void startLocationLoop();
    void incidentQueue.hydrate().then(() => {
      if (!incidentQueue.isEmpty) void flushIncidentQueue();
    });

    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      useIncidentStore.getState().setOnline(online);
      if (online && !incidentQueue.isEmpty) void flushIncidentQueue();
    });

    return () => unsubscribe();
  }, [token]);

  return (
    <SafeAreaProvider>
      {!token ? (
        <JoinScreen />
      ) : (
        <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.container}>
          <MapScreen viewMode="paramedic" />
          <GlobalToast />
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1f242b" },
  toast: {
    position: "absolute",
    bottom: 80,
    left: 16,
    right: 16,
    zIndex: 100,
  },
  toastInner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#00C37A",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    shadowColor: "#00C37A",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  toastDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#fff",
  },
  toastText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
