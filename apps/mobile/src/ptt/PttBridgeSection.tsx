import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { PttChannelKind, PttProviderStatus, PttRoute } from "@events/contracts";
import { getSocket } from "../realtime/socket-client";
import { debugLog } from "../debug/debug-log";
import { BridgeFlowControl, CHANNEL_THEME } from "./BridgeFlowControl";
import { fetchPttRoutes, fetchPttStatuses, setPttRoute } from "./ptt-api";

/**
 * Coordinator control over what this event forwards to and from the external
 * PTT networks. The connection itself (accounts, channel) is configured once in
 * the dashboard; here a coordinator only decides which way traffic flows for
 * the event they are running.
 */
export function PttBridgeSection() {
  const [routes, setRoutes] = useState<PttRoute[] | null>(null);
  const [statuses, setStatuses] = useState<PttProviderStatus[]>([]);
  const [pending, setPending] = useState<PttChannelKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [routeList, statusList] = await Promise.all([fetchPttRoutes(), fetchPttStatuses()]);
      setRoutes(routeList.routes);
      setStatuses(statusList);
      setError(null);
    } catch (err) {
      debugLog("api", "error", "ptt settings load failed", String(err));
      setError("Could not reach the command centre.");
    }
  }, []);

  useEffect(() => {
    void load();
    // The bridge pushes status changes into the ops room, so a reconnect or a
    // dashboard edit shows up here without polling.
    const socket = getSocket();
    const onStatus = (next: PttProviderStatus[]) => setStatuses(next);
    socket.on("ptt.status", onStatus);
    return () => {
      socket.off("ptt.status", onStatus);
    };
  }, [load]);

  const toggle = async (kind: PttChannelKind, direction: "inbound" | "outbound", next: boolean) => {
    // Optimistic: the switch should feel instant on a flaky event network.
    setRoutes((prev) => prev?.map((r) => (r.kind === kind ? { ...r, [direction]: next } : r)) ?? prev);
    setPending(kind);
    try {
      const updated = await setPttRoute(kind, { [direction]: next });
      setRoutes(updated.routes);
      setError(null);
    } catch (err) {
      debugLog("api", "error", "ptt route update failed", String(err));
      setError("Could not save — the change was rolled back.");
      void load();
    } finally {
      setPending(null);
    }
  };

  if (!routes) {
    return (
      <View style={styles.card}>
        {error ? (
          <Pressable style={styles.retry} onPress={() => void load()}>
            <Feather name="refresh-cw" size={14} color="#f87171" />
            <Text style={styles.retryText}>{error} Tap to retry.</Text>
          </Pressable>
        ) : (
          <ActivityIndicator color="#34d399" />
        )}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {routes.map((route, index) => {
        const status = statuses.find((s) => s.kind === route.kind);
        const theme = CHANNEL_THEME[route.kind];
        const live = status?.state === "online";
        // A channel that is off or unconfigured server-side cannot carry
        // anything, so its switches are disabled rather than misleading.
        const unavailable = !status || status.state === "disabled" || !status.configured;

        return (
          <View key={route.kind} style={index > 0 ? styles.blockDivider : undefined}>
            <View style={styles.blockHead}>
              <Text style={styles.blockTitle}>{theme.label}</Text>
              <View style={[styles.statusPill, live ? { borderColor: "#34d39966", backgroundColor: "rgba(52,211,153,0.14)" } : null]}>
                <View style={[styles.statusDot, { backgroundColor: live ? "#34d399" : unavailable ? "#475569" : "#fbbf24" }]} />
                <Text style={[styles.statusText, live && { color: "#34d399" }]}>
                  {live ? (status?.channel ?? "Connected") : unavailable ? "Not set up" : (status?.state ?? "offline")}
                </Text>
              </View>
            </View>

            <BridgeFlowControl
              kind={route.kind}
              inbound={route.inbound}
              outbound={route.outbound}
              live={live}
              disabled={unavailable}
              busy={pending === route.kind}
              onToggle={(direction, next) => void toggle(route.kind, direction, next)}
            />

            {unavailable ? (
              <Text style={styles.blockNote}>
                {status?.detail ?? "Set this channel up in the dashboard before it can carry traffic."}
              </Text>
            ) : null}
          </View>
        );
      })}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Text style={styles.note}>
        Text, voice, photos and locations cross the bridge in whichever directions are on. Messages arriving from a
        channel are tagged in the chat and are never sent back out.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#0c1626",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.1)",
    padding: 16,
    gap: 12,
    minHeight: 60,
    justifyContent: "center",
  },
  blockDivider: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: "rgba(148,163,184,0.12)" },
  blockHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  blockTitle: { color: "#e2e8f0", fontSize: 15, fontWeight: "800" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
    backgroundColor: "rgba(148,163,184,0.08)",
    maxWidth: "58%",
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { color: "#94a3b8", fontSize: 11, fontWeight: "800", flexShrink: 1 },
  blockNote: { color: "#475569", fontSize: 11.5, fontWeight: "500", lineHeight: 16, marginTop: 9 },
  note: { color: "#475569", fontSize: 11.5, fontWeight: "500", lineHeight: 16, marginTop: 4 },
  errorText: { color: "#f87171", fontSize: 12, fontWeight: "700" },
  retry: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center" },
  retryText: { color: "#f87171", fontSize: 12.5, fontWeight: "700" },
});
