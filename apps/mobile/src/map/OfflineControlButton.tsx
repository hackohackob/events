import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  deleteEventPack,
  downloadEventPack,
  getEventPackStatus,
  type OfflineProgress,
} from "./offline-tiles";
import { OfflineDownloadModal, type OfflineQuality } from "./OfflineDownloadModal";
import { debugLog } from "../debug/debug-log";

interface Props {
  tilesUrl: string;
  tileSize: number;
  getBounds: () => [number, number, number, number] | null;
}

type Phase = "idle" | "downloading" | "ready" | "error";

/**
 * Square control-stack button that downloads the current map area for offline use.
 * Matches the layers / locate / compass buttons; shows a progress % while caching
 * and a green check when saved (long-press / tap-when-ready removes the pack).
 */
export function OfflineControlButton({ tilesUrl, tileSize, getBounds }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void getEventPackStatus().then((status) => {
      if (active && status && (status.state === "complete" || status.percentage >= 100)) {
        setPhase("ready");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const onProgress = (p: OfflineProgress) => {
    setPct(Math.round(p.percentage));
    if (p.state === "complete" || p.percentage >= 100) {
      setPhase("ready");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const press = async () => {
    if (phase === "downloading") {
      // Tap while downloading cancels it (handy to escape a slow "Detailed" pack).
      await deleteEventPack();
      setPhase("idle");
      setPct(0);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    if (phase === "ready") {
      // Tapping a saved map removes it (frees space).
      await deleteEventPack();
      setPhase("idle");
      setPct(0);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    // idle / error → ask first (size + quality).
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setModalOpen(true);
  };

  const startDownload = async (quality: OfflineQuality) => {
    setModalOpen(false);
    const bounds = getBounds();
    if (!bounds) {
      setPhase("error");
      setTimeout(() => setPhase("idle"), 2500);
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
        minZoom: quality.minZoom,
        maxZoom: quality.maxZoom,
        onProgress,
        onError: () => setPhase("error"),
      });
    } catch (err) {
      debugLog("app", "error", "offline download failed", String(err));
      setPhase("error");
      setTimeout(() => setPhase("idle"), 2500);
    }
  };

  return (
    <>
      <Pressable
        style={[
          styles.button,
          phase === "ready" && styles.buttonReady,
          phase === "error" && styles.buttonError,
        ]}
        onPress={press}
      >
        {phase === "downloading" ? (
          <View style={styles.center}>
            <ActivityIndicator size="small" color="#60a5fa" />
            <Text style={styles.pctText}>{pct}%</Text>
          </View>
        ) : phase === "ready" ? (
          <View style={styles.readyWrap}>
            <Feather name="download-cloud" size={20} color="#34d399" />
            <View style={styles.readyBadge}>
              <Feather name="check" size={8} color="#04121f" />
            </View>
          </View>
        ) : phase === "error" ? (
          <Feather name="alert-triangle" size={19} color="#f87171" />
        ) : (
          <Feather name="download-cloud" size={20} color="#ecf4ff" />
        )}
      </Pressable>

      <OfflineDownloadModal
        visible={modalOpen}
        bounds={getBounds()}
        tileSize={tileSize}
        onClose={() => setModalOpen(false)}
        onConfirm={startDownload}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: "rgba(8, 15, 28, 0.93)",
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.22)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  buttonReady: { borderColor: "rgba(52, 211, 153, 0.5)", backgroundColor: "rgba(6, 24, 20, 0.93)" },
  buttonError: { borderColor: "rgba(248, 113, 113, 0.5)" },
  center: { alignItems: "center", justifyContent: "center" },
  pctText: { color: "#93c5fd", fontSize: 8, fontWeight: "800", marginTop: 1 },
  readyWrap: { alignItems: "center", justifyContent: "center" },
  readyBadge: {
    position: "absolute",
    bottom: -5,
    right: -7,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#34d399",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(6, 24, 20, 0.95)",
  },
});
