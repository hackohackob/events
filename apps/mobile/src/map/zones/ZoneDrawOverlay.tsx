import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { MapRef } from "@maplibre/maplibre-react-native";
import { useZoneDrawStore } from "./zone-draw-store";
import { useZonesStore } from "./zones-store";
import { createZone } from "./zone-api";
import { debugLog } from "../../debug/debug-log";

const ZONE_COLORS = ["#f59e0b", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#14b8a6"];

/**
 * Freehand zone drawing UI, layered over the map:
 *  - "draw" phase: a full-screen touch catcher — the finger trail is unprojected
 *    to [lng, lat] in batches and previewed live by ZoneSketchLayer.
 *  - "name" phase: a bottom card to name/colour the zone + set the entry alarm.
 */
export function ZoneDrawOverlay({ mapRef }: { mapRef: React.RefObject<MapRef | null> }) {
  const phase = useZoneDrawStore((s) => s.phase);
  const pending = useZoneDrawStore((s) => s.pending);
  const cancel = useZoneDrawStore((s) => s.cancel);
  const finishSketch = useZoneDrawStore((s) => s.finishSketch);
  const upsertZone = useZonesStore((s) => s.upsert);

  const [name, setName] = useState("");
  const [color, setColor] = useState(ZONE_COLORS[0]);
  const [alarm, setAlarm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Pixel queue → unproject pump. Move events arrive far faster than the async
  // bridge round-trips, so points are queued and drained in ordered batches.
  const pixelQueue = useRef<Array<[number, number]>>([]);
  const pumping = useRef(false);
  const pump = async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      while (pixelQueue.current.length > 0) {
        const batch = pixelQueue.current.splice(0, pixelQueue.current.length);
        const map = mapRef.current;
        if (!map) return;
        const coords = await Promise.all(batch.map((p) => map.unproject(p)));
        const valid = coords.filter(
          (c): c is [number, number] =>
            Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
        );
        // Drawing may have been cancelled while unprojection was in flight.
        if (useZoneDrawStore.getState().phase !== "draw") return;
        if (valid.length > 0) useZoneDrawStore.getState().appendSketch(valid);
      }
    } catch (err) {
      debugLog("app", "error", "zone sketch unproject failed", String(err));
    } finally {
      pumping.current = false;
    }
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        useZoneDrawStore.getState().resetSketch();
        pixelQueue.current = [[event.nativeEvent.pageX, event.nativeEvent.pageY]];
        void pump();
      },
      onPanResponderMove: (event) => {
        pixelQueue.current.push([event.nativeEvent.pageX, event.nativeEvent.pageY]);
        void pump();
      },
      onPanResponderRelease: () => {
        // Let the in-flight batch land before smoothing.
        setTimeout(() => {
          if (useZoneDrawStore.getState().phase === "draw") {
            finishSketch();
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }
        }, 120);
      },
    }),
  ).current;

  const save = async () => {
    if (!pending || saving) return;
    setSaving(true);
    try {
      const zone = await createZone({
        name: name.trim() || "Zone",
        color,
        alarm,
        polygon: pending,
      });
      upsertZone(zone);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setName("");
      setAlarm(false);
      cancel();
    } catch (err) {
      debugLog("api", "error", "zone create failed", String(err));
    } finally {
      setSaving(false);
    }
  };

  if (phase === "idle") return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Touch catcher — grabs the whole screen while sketching. */}
      {phase === "draw" ? <View style={StyleSheet.absoluteFill} {...responder.panHandlers} /> : null}

      {/* Hint banner + cancel */}
      <View style={styles.banner} pointerEvents="box-none">
        <View style={styles.bannerPill}>
          <Feather name="edit-3" size={14} color="#f59e0b" />
          <Text style={styles.bannerText}>
            {phase === "draw" ? "Draw the zone with your finger" : "Name the new zone"}
          </Text>
        </View>
        <Pressable
          style={styles.cancelBtn}
          onPress={() => {
            cancel();
            setName("");
            setAlarm(false);
          }}
          hitSlop={8}
        >
          <Feather name="x" size={18} color="#fca5a5" />
        </Pressable>
      </View>

      {/* Naming card */}
      {phase === "name" ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>NEW ZONE</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Zone name"
            placeholderTextColor="#5b6b80"
            style={styles.input}
            autoFocus
          />
          <View style={styles.swatchRow}>
            {ZONE_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchActive]}
              />
            ))}
          </View>
          <View style={styles.alarmRow}>
            <Feather name="bell" size={15} color="#f59e0b" />
            <Text style={styles.alarmText}>Alarm medics entering this zone</Text>
            <Switch
              value={alarm}
              onValueChange={setAlarm}
              trackColor={{ false: "#1e293b", true: "#b45309" }}
              thumbColor="#f1f5f9"
            />
          </View>
          <View style={styles.cardActions}>
            <Pressable
              style={[styles.actionBtn, styles.saveBtn]}
              onPress={() => void save()}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#04121f" />
              ) : (
                <Text style={styles.saveBtnText}>Save zone</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.actionBtn, styles.redrawBtn]}
              onPress={() => useZoneDrawStore.getState().start()}
            >
              <Text style={styles.redrawBtnText}>Redraw</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 70,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    zIndex: 60,
  },
  bannerPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(31, 22, 6, 0.95)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.45)",
    borderRadius: 13,
    paddingVertical: 10,
    paddingHorizontal: 13,
  },
  bannerText: { color: "#fcd34d", fontSize: 13, fontWeight: "800", flex: 1 },
  cancelBtn: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: "rgba(40, 8, 8, 0.95)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 24,
    backgroundColor: "rgba(8, 15, 28, 0.98)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    padding: 14,
    gap: 11,
    zIndex: 60,
  },
  cardTitle: { color: "#64748b", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#eff6ff",
    fontSize: 15,
    fontWeight: "700",
  },
  swatchRow: { flexDirection: "row", gap: 9 },
  swatch: { width: 30, height: 30, borderRadius: 10, borderWidth: 2, borderColor: "transparent" },
  swatchActive: { borderColor: "#ffffff" },
  alarmRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  alarmText: { color: "#cbd5e1", fontSize: 13, fontWeight: "700", flex: 1 },
  cardActions: { flexDirection: "row", gap: 9 },
  actionBtn: {
    flex: 1,
    borderRadius: 13,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtn: { backgroundColor: "#34d399" },
  saveBtnText: { color: "#04121f", fontSize: 14, fontWeight: "900" },
  redrawBtn: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
  },
  redrawBtnText: { color: "#cbd5e1", fontSize: 14, fontWeight: "800" },
});
