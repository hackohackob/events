import React, { useEffect, useRef } from "react";
import { Animated, AppState, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import NetInfo from "@react-native-community/netinfo";
import { JoinScreen } from "./auth/JoinScreen";
import { incidentQueue } from "./incidents/persistent-incident-queue";
import { flushIncidentQueue } from "./incidents/flush-incidents";
import { startIncidentReport } from "./incidents/start-report";
import { useIncidentStore } from "./incidents/incident-store";
import { startLocationLoop, sendCurrentLocationNow } from "./location/location-tracker";
import { showTrackingNotification, hideTrackingNotification, consumeInitialNotification } from "./notifications/foreground-notification";
import { registerPushToken } from "./notifications/push-registration";
import { MapScreen } from "./map/MapScreen";
import { useSessionStore } from "./security/session-store";
import { useSettingsStore } from "./settings/settings-store";

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

  // Nothing to show → render nothing. (Previously the green bar stayed parked at
  // the bottom of the screen because it was always mounted.)
  if (!toastMessage) return null;

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
  const role = useSessionStore((state) => state.role);
  const hydrated = useSessionStore((state) => state.hydrated);
  const hydrate = useSessionStore((state) => state.hydrate);
  const reportRequestId = useIncidentStore((state) => state.reportRequestId);

  useEffect(() => {
    void hydrate();
    void useSettingsStore.getState().hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!token) return;

    void startLocationLoop().then((started) => {
      if (started) {
        void showTrackingNotification(role === "medic" || role === "paramedic");
      } else {
        void hideTrackingNotification();
      }
    });
    // Register for push so the backend can alert this device when the app is closed.
    void registerPushToken();
    // If the app was launched by tapping an incident notification, focus it.
    void consumeInitialNotification();
    void incidentQueue.hydrate().then(() => {
      if (!incidentQueue.isEmpty) void flushIncidentQueue();
    });

    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      useIncidentStore.getState().setOnline(online);
      if (online && !incidentQueue.isEmpty) void flushIncidentQueue();
    });

    return () => unsubscribe();
  }, [token, role]);

  // Send a fresh location every time the app is opened/brought to the foreground,
  // so a medic immediately appears at their position without waiting for the
  // background timer (or having to press "Send location" in the Debug tab).
  useEffect(() => {
    if (!token) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void sendCurrentLocationNow();
    });
    return () => sub.remove();
  }, [token]);

  // "Report incident" pressed from the persistent notification.
  useEffect(() => {
    if (reportRequestId > 0) {
      void startIncidentReport();
    }
  }, [reportRequestId]);

  let content: React.ReactNode;
  if (!hydrated) {
    content = (
      <View style={[styles.container, { alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ color: "#64748b", fontSize: 14 }}>Loading…</Text>
      </View>
    );
  } else if (!token) {
    content = <JoinScreen />;
  } else {
    content = (
      <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.container}>
        <MapScreen viewMode="paramedic" />
        <GlobalToast />
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <BottomSheetModalProvider>{content}</BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
