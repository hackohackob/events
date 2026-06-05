import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import {
  deleteEventPack,
  downloadEventPack,
  getEventPackStatus,
  type OfflineProgress,
} from "./offline-tiles";
import { debugLog } from "../debug/debug-log";

interface Props {
  tilesUrl: string;
  tileSize: number;
  /** Returns [west, south, east, north] for the area to cache, or null if unknown. */
  getBounds: () => [number, number, number, number] | null;
}

type Phase = "idle" | "checking" | "downloading" | "ready" | "error";

export function OfflineMapButton({ tilesUrl, tileSize, getBounds }: Props) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [pct, setPct] = useState(0);
  const [tiles, setTiles] = useState(0);

  useEffect(() => {
    let active = true;
    void getEventPackStatus().then((status) => {
      if (!active) return;
      if (status && (status.state === "complete" || status.percentage >= 100)) {
        setPhase("ready");
        setTiles(status.completedTileCount);
      } else {
        setPhase("idle");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const onProgress = (p: OfflineProgress) => {
    setPct(Math.round(p.percentage));
    setTiles(p.completedTileCount);
    if (p.state === "complete" || p.percentage >= 100) {
      setPhase("ready");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const start = async () => {
    const bounds = getBounds();
    if (!bounds) {
      setPhase("error");
      return;
    }
    setPhase("downloading");
    setPct(0);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await downloadEventPack({
        tilesUrl,
        tileSize,
        bounds,
        onProgress,
        onError: () => setPhase("error"),
      });
    } catch (err) {
      debugLog("app", "error", "download failed", String(err));
      setPhase("error");
    }
  };

  const remove = async () => {
    await deleteEventPack();
    setPhase("idle");
    setPct(0);
    setTiles(0);
  };

  if (phase === "checking") return null;

  return (
    <View style={styles.wrap}>
      {phase === "ready" ? (
        <Pressable style={[styles.pill, styles.readyPill]} onPress={remove}>
          <Text style={styles.readyIcon}>⤓</Text>
          <Text style={styles.readyText}>Offline map saved{tiles ? ` · ${tiles} tiles` : ""}</Text>
          <Text style={styles.removeText}>Remove</Text>
        </Pressable>
      ) : phase === "downloading" ? (
        <View style={[styles.pill, styles.dlPill]}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.dlText}>Caching map… {pct}%</Text>
        </View>
      ) : (
        <Pressable style={[styles.pill, styles.idlePill]} onPress={start}>
          <Text style={styles.idleIcon}>⤓</Text>
          <Text style={styles.idleText}>
            {phase === "error" ? "Retry offline download" : "Download offline map"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "flex-start" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 22,
    backgroundColor: "rgba(9, 15, 29, 0.94)",
    borderWidth: 1,
  },
  idlePill: { borderColor: "rgba(59,130,246,0.4)" },
  idleIcon: { color: "#60a5fa", fontSize: 15, fontWeight: "900" },
  idleText: { color: "#93c5fd", fontSize: 12, fontWeight: "800" },
  dlPill: { borderColor: "rgba(59,130,246,0.4)", minWidth: 200 },
  dlText: { color: "#93c5fd", fontSize: 11, fontWeight: "800" },
  progressTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: "rgba(148,163,184,0.2)", overflow: "hidden" },
  progressFill: { height: 5, borderRadius: 3, backgroundColor: "#3b82f6" },
  readyPill: { borderColor: "rgba(34,197,94,0.4)" },
  readyIcon: { color: "#34d399", fontSize: 15, fontWeight: "900" },
  readyText: { color: "#86efac", fontSize: 12, fontWeight: "800" },
  removeText: { color: "#64748b", fontSize: 11, fontWeight: "700", marginLeft: 4 },
});
