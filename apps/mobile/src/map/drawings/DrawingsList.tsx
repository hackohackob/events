import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { EventDrawing } from "@events/contracts";
import { formatDistance } from "./drawing-geometry";
import { useDrawingsStore } from "./drawings-store";

/**
 * The Drawings tab of the layers sheet: what the coordinators have sketched
 * for the team, each with its note. Tapping one frames it on the map; the
 * switches only change what THIS phone shows.
 */
export function DrawingsList({ onOpen }: { onOpen: (drawing: EventDrawing) => void }) {
  const all = useDrawingsStore((s) => s.drawings);
  const enabled = useDrawingsStore((s) => s.enabled);
  const hidden = useDrawingsStore((s) => s.hidden);
  // "Hidden from the team" on the dashboard means not ours to list at all.
  const drawings = all.filter((d) => d.visible);

  return (
    <>
      <Pressable
        style={styles.masterRow}
        onPress={() => {
          void Haptics.selectionAsync();
          useDrawingsStore.getState().setEnabled(!enabled);
        }}
      >
        <Text style={styles.masterLabel}>Show drawings on the map</Text>
        <Switch on={enabled} />
      </Pressable>

      {drawings.length === 0 ? (
        <Text style={styles.empty}>Nothing drawn for the team yet.</Text>
      ) : null}

      {drawings.map((drawing) => {
        const shown = enabled && !hidden[drawing.id];
        return (
          <View key={drawing.id} style={[styles.row, !shown && styles.rowOff]}>
            <Pressable
              style={styles.rowMain}
              onPress={() => {
                void Haptics.selectionAsync();
                // Asking to see one that was switched off means "show me".
                if (!enabled) useDrawingsStore.getState().setEnabled(true);
                if (hidden[drawing.id]) useDrawingsStore.getState().setHidden(drawing.id, false);
                onOpen(drawing);
              }}
            >
              <View style={styles.swatch}>
                <View
                  style={[
                    styles.swatchLine,
                    drawing.dashed
                      ? { borderColor: drawing.color, borderTopWidth: 3, borderStyle: "dashed", backgroundColor: "transparent" }
                      : { backgroundColor: drawing.color },
                  ]}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.name, !drawing.name && styles.untitled]} numberOfLines={1}>
                  {drawing.name || "Untitled"}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {formatDistance(drawing.distanceMeters)}
                  {drawing.snapped ? " · follows roads" : ""}
                </Text>
                {drawing.note ? (
                  <Text style={styles.note} numberOfLines={3}>
                    {drawing.note}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            <Pressable
              hitSlop={8}
              onPress={() => {
                void Haptics.selectionAsync();
                useDrawingsStore.getState().setHidden(drawing.id, !hidden[drawing.id]);
              }}
            >
              <Switch on={shown} />
            </Pressable>
          </View>
        );
      })}
    </>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <View style={[styles.switchTrack, on && styles.switchTrackOn]}>
      <View style={[styles.switchKnob, on && styles.switchKnobOn]} />
    </View>
  );
}

const styles = StyleSheet.create({
  masterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  masterLabel: { color: "#cfe0f4", fontSize: 13, fontWeight: "600" },
  empty: { color: "#64748b", fontSize: 12, paddingVertical: 8, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginTop: 6,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
  },
  rowOff: { opacity: 0.55 },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  swatch: {
    width: 26,
    height: 14,
    marginTop: 2,
    borderRadius: 7,
    backgroundColor: "#0b1220",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  swatchLine: { height: 3, borderRadius: 2 },
  rowText: { flex: 1 },
  name: { color: "#f1f5f9", fontSize: 13, fontWeight: "700" },
  untitled: { color: "#94a3b8", fontStyle: "italic", fontWeight: "600" },
  meta: { color: "#64748b", fontSize: 11, fontWeight: "600", marginTop: 1 },
  note: { color: "#cbd5e1", fontSize: 12, lineHeight: 16, marginTop: 4 },
  switchTrack: {
    width: 38,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(100,116,139,0.45)",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  switchTrackOn: { backgroundColor: "#22c55e" },
  switchKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#ffffff" },
  switchKnobOn: { alignSelf: "flex-end" },
});
