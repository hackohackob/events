import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { JoinScreen } from "./auth/JoinScreen";
import { startLocationLoop } from "./location/location-tracker";
import { MapScreen } from "./map/MapScreen";
import { useSessionStore } from "./security/session-store";

export default function App() {
  const token = useSessionStore((state) => state.token);

  useEffect(() => {
    if (token) {
      void startLocationLoop();
    }
  }, [token]);

  return (
    <SafeAreaProvider>
      {!token ? (
        <JoinScreen />
      ) : (
        <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.container}>
          <MapScreen viewMode="paramedic" />
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1f242b" },
});
