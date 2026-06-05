import React, { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ExpoLocation from "expo-location";
import * as Battery from "expo-battery";
import { LOCATION_TASK_NAME, sendCurrentLocationNow } from "../location/location-tracker";
import * as TaskManager from "expo-task-manager";
import { isBatteryOptimizationIgnored } from "../location/battery-optimization";
import { resolveLocalhostUrl } from "../ui/runtime-host";
import { useLocationStatus } from "./location-status";
import { freshnessLabel } from "../map/freshness";
import { useSessionStore } from "../security/session-store";

const API_BASE_URL = resolveLocalhostUrl(
  process.env.EXPO_PUBLIC_API_URL ?? "https://events-api.hackohackob.com/api",
);

function Row({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "#22ff88" : tone === "warn" ? "#f5c518" : tone === "bad" ? "#ff6b6b" : "#cdd9e8";
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function LocationScreen() {
  const lastFix = useLocationStatus((s) => s.lastFix);
  const lastReport = useLocationStatus((s) => s.lastReport);
  const role = useSessionStore((s) => s.role);
  const eventId = useSessionStore((s) => s.eventId);

  const [fgPerm, setFgPerm] = useState<string>("?");
  const [bgPerm, setBgPerm] = useState<string>("?");
  const [taskRegistered, setTaskRegistered] = useState<boolean | null>(null);
  const [battOpt, setBattOpt] = useState<boolean | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [serverMs, setServerMs] = useState<number | null>(null);
  const [, setNow] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const refreshDiagnostics = useCallback(async () => {
    const [fg, bg, registered, optIgnored, battLevel] = await Promise.all([
      ExpoLocation.getForegroundPermissionsAsync().then((p) => p.status).catch(() => "error"),
      ExpoLocation.getBackgroundPermissionsAsync().then((p) => p.status).catch(() => "error"),
      TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(() => false),
      isBatteryOptimizationIgnored().catch(() => null),
      Battery.getBatteryLevelAsync().catch(() => -1),
    ]);
    setFgPerm(fg);
    setBgPerm(bg);
    setTaskRegistered(registered);
    setBattOpt(optIgnored);
    setBattery(battLevel >= 0 ? battLevel : null);

    const started = Date.now();
    try {
      const res = await fetch(`${API_BASE_URL}/health/live`);
      setServerOk(res.ok);
      setServerMs(Date.now() - started);
    } catch {
      setServerOk(false);
      setServerMs(null);
    }
  }, []);

  useEffect(() => {
    void refreshDiagnostics();
    const tick = setInterval(() => setNow((n) => n + 1), 1000);
    const diag = setInterval(() => void refreshDiagnostics(), 15_000);
    return () => {
      clearInterval(tick);
      clearInterval(diag);
    };
  }, [refreshDiagnostics]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshDiagnostics();
    setRefreshing(false);
  }, [refreshDiagnostics]);

  const fixAge = lastFix ? Date.now() - lastFix.at : undefined;
  const reportAge = lastReport ? Date.now() - lastReport.at : undefined;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22ff88" />}
    >
      <Text style={styles.heading}>Location diagnostics</Text>

      <Section title="LAST GPS FIX">
        {lastFix ? (
          <>
            <Row label="Coordinates" value={`${lastFix.lat.toFixed(6)}, ${lastFix.lng.toFixed(6)}`} />
            <Row label="Accuracy" value={lastFix.accuracy != null ? `±${Math.round(lastFix.accuracy)} m` : "unknown"} />
            <Row label="Captured" value={freshnessLabel(fixAge)} tone={fixAge != null && fixAge < 60_000 ? "ok" : "warn"} />
            <Row label="Battery (fix)" value={lastFix.battery != null ? `${Math.round(lastFix.battery * 100)}%` : "unknown"} />
          </>
        ) : (
          <Row label="Status" value="No fix captured yet" tone="warn" />
        )}
      </Section>

      <Section title="LAST SERVER REPORT">
        {lastReport ? (
          <>
            <Row label="Result" value={lastReport.ok ? "Sent ✓" : "Failed ✗"} tone={lastReport.ok ? "ok" : "bad"} />
            <Row label="Channel" value={lastReport.via.toUpperCase()} />
            <Row label="When" value={freshnessLabel(reportAge)} tone={reportAge != null && reportAge < 90_000 ? "ok" : "warn"} />
            {lastReport.error ? <Row label="Error" value={lastReport.error} tone="bad" /> : null}
          </>
        ) : (
          <Row label="Status" value="Nothing reported yet" tone="warn" />
        )}
        <Pressable style={styles.btn} onPress={() => void sendCurrentLocationNow()}>
          <Text style={styles.btnText}>Send location now</Text>
        </Pressable>
      </Section>

      <Section title="PERMISSIONS & SERVICE">
        <Row label="Foreground perm" value={fgPerm} tone={fgPerm === "granted" ? "ok" : "bad"} />
        <Row label="Background perm" value={bgPerm} tone={bgPerm === "granted" ? "ok" : "warn"} />
        <Row label="Bg task registered" value={taskRegistered == null ? "?" : taskRegistered ? "yes" : "no"} tone={taskRegistered ? "ok" : "bad"} />
        <Row
          label="Battery optimization"
          value={battOpt == null ? "?" : battOpt ? "exempt ✓" : "restricting ✗"}
          tone={battOpt ? "ok" : "bad"}
        />
        <Row label="Device battery" value={battery != null ? `${Math.round(battery * 100)}%` : "unknown"} />
      </Section>

      <Section title="SERVER">
        <Row label="Reachable" value={serverOk == null ? "checking…" : serverOk ? "online ✓" : "offline ✗"} tone={serverOk ? "ok" : "bad"} />
        <Row label="Latency" value={serverMs != null ? `${serverMs} ms` : "—"} />
        <Row label="API base" value={API_BASE_URL} />
        <Row label="Role / event" value={`${role} / ${eventId ?? "—"}`} />
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020b18" },
  content: { padding: 16, paddingBottom: 40 },
  heading: { color: "#eff6ff", fontSize: 20, fontWeight: "900", marginBottom: 16 },
  section: {
    backgroundColor: "#0b1729",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
  },
  sectionTitle: { color: "#5f7da0", fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5, gap: 12 },
  rowLabel: { color: "#7c8a9c", fontSize: 13, fontWeight: "600" },
  rowValue: { color: "#cdd9e8", fontSize: 13, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  btn: {
    marginTop: 12,
    backgroundColor: "#163a2c",
    borderColor: "#22ff88",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  btnText: { color: "#22ff88", fontSize: 14, fontWeight: "800" },
});
