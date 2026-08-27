import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSettingsStore } from "../settings/settings-store";
import {
  MAP_ELEMENTS,
  MAP_ELEMENT_GROUPS,
  MAP_Z_PRESETS,
  mapDebugDirtyCount,
  useMapDebug,
} from "./map-debug";

/**
 * Map settings — the overlay bisect, in the hands of whoever has the phone.
 *
 * The whole screen is written for someone who will never read the code: it
 * opens with what to do, the map-layer control comes first because it settles
 * the question fastest, and every switch says what the thing looks like on
 * screen rather than what it is called in the source.
 */
export function MapDebugSettings({ onClose }: { onClose?: () => void }) {
  const hidden = useMapDebug((s) => s.hidden);
  const mapZIndex = useMapDebug((s) => s.mapZIndex);
  const toggle = useMapDebug((s) => s.toggle);
  const setAllHidden = useMapDebug((s) => s.setAllHidden);
  const setMapZIndex = useMapDebug((s) => s.setMapZIndex);
  const reset = useMapDebug((s) => s.reset);
  // A real saved preference, not part of the bisect: it survives a restart
  // and is deliberately excluded from the dirty count and Reset below.
  const simpleReportButton = useSettingsStore((s) => s.simpleReportButton);
  const setSimpleReportButton = useSettingsStore((s) => s.setSimpleReportButton);

  const hiddenCount = useMemo(() => Object.values(hidden).filter(Boolean).length, [hidden]);
  const dirty = mapDebugDirtyCount(hidden, mapZIndex) > 0;

  const tap = () => void Haptics.selectionAsync();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {onClose ? (
          <Pressable style={styles.backBtn} onPress={onClose} hitSlop={10}>
            <Feather name="chevron-left" size={22} color="#cbd5e1" />
          </Pressable>
        ) : null}
        <Text style={styles.heading}>Map settings</Text>
        {dirty ? (
          <Pressable
            style={styles.resetBtn}
            onPress={() => {
              tap();
              reset();
            }}
          >
            <Feather name="rotate-ccw" size={13} color="#1c1207" />
            <Text style={styles.resetBtnText}>Reset</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* First, because it is the answer for every device that has hit this
            so far — and the only control here that is remembered. */}
        <View style={[styles.fix, simpleReportButton && styles.fixOn]}>
          <View style={styles.fixHead}>
            <View style={styles.fixText}>
              <Text style={styles.fixTitle}>Simple report buttons</Text>
              <Text style={styles.fixHint}>
                Replaces the round “+” button with two plain buttons.
              </Text>
            </View>
            <Switch
              value={simpleReportButton}
              onValueChange={(next) => {
                tap();
                setSimpleReportButton(next);
              }}
              trackColor={{ false: "#1e293b", true: "#0f766e" }}
              thumbColor={simpleReportButton ? "#34d399" : "#64748b"}
            />
          </View>
          <Text style={styles.fixBody}>
            <Text style={styles.strong}>Turn this on if the map will not move.</Text> The round
            button sits on an invisible full-screen layer, and on some Android phones that layer
            swallows dragging and pinching on the map while normal taps still work. The plain
            buttons do the same two jobs without that layer.
          </Text>
          <Text style={styles.fixFoot}>This one is remembered, and survives a restart.</Text>
        </View>

        <View style={styles.explainer}>
          <Text style={styles.explainerTitle}>Still not moving?</Text>
          <Text style={styles.explainerText}>
            Then something else is sitting on top of it. Start with{" "}
            <Text style={styles.strong}>Map layer → Top</Text> — if the map moves then, one of the
            overlays below is the problem. Put the layer back to Default and turn overlays off one
            at a time until it moves again. The last one you switched off is the culprit.
          </Text>
          <Text style={styles.explainerFoot}>
            Nothing here is saved. Restart the app and everything is back to normal.
          </Text>
        </View>

        {/* ── Map layer ───────────────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Map layer</Text>
        <Text style={styles.sectionHint}>
          How high the map sits in the stack. Higher means it gets your finger first — but it also
          covers the buttons, so put it back when you're done.
        </Text>
        <View style={styles.presetWrap}>
          {MAP_Z_PRESETS.map((preset) => {
            const active = mapZIndex === preset.value;
            return (
              <Pressable
                key={preset.value}
                style={[styles.preset, active && styles.presetActive]}
                onPress={() => {
                  tap();
                  setMapZIndex(preset.value);
                }}
              >
                <Text style={[styles.presetLabel, active && styles.presetLabelActive]}>
                  {preset.label}
                </Text>
                <Text style={[styles.presetHint, active && styles.presetHintActive]}>{preset.hint}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* ── Overlays ────────────────────────────────────────────────────── */}
        <View style={styles.overlaysHead}>
          <Text style={styles.sectionTitle}>Overlays</Text>
          <View style={styles.bulkWrap}>
            <Pressable
              style={styles.bulkBtn}
              onPress={() => {
                tap();
                setAllHidden(true);
              }}
            >
              <Text style={styles.bulkText}>Hide all</Text>
            </Pressable>
            <Pressable
              style={styles.bulkBtn}
              onPress={() => {
                tap();
                setAllHidden(false);
              }}
            >
              <Text style={styles.bulkText}>Show all</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.sectionHint}>
          {hiddenCount === 0
            ? "Everything is on, exactly as normal."
            : `${hiddenCount} hidden. Switch them back on one by one to find the one that matters.`}
        </Text>

        {MAP_ELEMENT_GROUPS.map((group) => {
          const items = MAP_ELEMENTS.filter((element) => element.group === group);
          if (items.length === 0) return null;
          return (
            <View key={group} style={styles.group}>
              <Text style={styles.groupTitle}>{group}</Text>
              {items.map((element, index) => {
                const isHidden = hidden[element.id] === true;
                return (
                  <View
                    key={element.id}
                    style={[styles.row, index === items.length - 1 && styles.rowLast]}
                  >
                    <View style={styles.rowText}>
                      <Text style={[styles.rowLabel, isHidden && styles.rowLabelOff]}>
                        {element.label}
                      </Text>
                      <Text style={styles.rowHint}>{element.hint}</Text>
                    </View>
                    <Switch
                      value={!isHidden}
                      onValueChange={() => {
                        tap();
                        toggle(element.id);
                      }}
                      trackColor={{ false: "#1e293b", true: "#0f766e" }}
                      thumbColor={isHidden ? "#64748b" : "#34d399"}
                    />
                  </View>
                );
              })}
            </View>
          );
        })}

        <Text style={styles.footer}>
          On the map itself, an orange chip appears whenever anything here is changed. Tap it to put
          everything back.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020b18" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  heading: { color: "#eff6ff", fontSize: 20, fontWeight: "900" },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginLeft: "auto",
    backgroundColor: "#f59e0b",
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  resetBtnText: { color: "#1c1207", fontSize: 12, fontWeight: "900" },

  body: { padding: 16, paddingBottom: 48 },

  fix: {
    backgroundColor: "rgba(245,158,11,0.08)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  fixOn: {
    backgroundColor: "rgba(52,211,153,0.09)",
    borderColor: "rgba(52,211,153,0.4)",
  },
  fixHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  fixText: { flex: 1 },
  fixTitle: { color: "#eff6ff", fontSize: 15, fontWeight: "900" },
  fixHint: { color: "#9fb3cc", fontSize: 12, marginTop: 2 },
  fixBody: { color: "#c7d6e6", fontSize: 13, lineHeight: 20, marginTop: 10 },
  fixFoot: { color: "#5f7da0", fontSize: 11, marginTop: 8 },

  explainer: {
    backgroundColor: "rgba(52,211,153,0.07)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.22)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 22,
  },
  explainerTitle: { color: "#34d399", fontSize: 14, fontWeight: "900", marginBottom: 6 },
  explainerText: { color: "#c7d6e6", fontSize: 13, lineHeight: 20 },
  explainerFoot: { color: "#5f7da0", fontSize: 11, lineHeight: 16, marginTop: 8 },
  strong: { color: "#eff6ff", fontWeight: "900" },

  sectionTitle: { color: "#eff6ff", fontSize: 15, fontWeight: "900", marginBottom: 4 },
  sectionHint: { color: "#7c8a9c", fontSize: 12, lineHeight: 18, marginBottom: 12 },

  presetWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 26 },
  preset: {
    flexGrow: 1,
    minWidth: 96,
    backgroundColor: "#0b1729",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  presetActive: { backgroundColor: "#f59e0b", borderColor: "#f59e0b" },
  presetLabel: { color: "#dbe6f3", fontSize: 14, fontWeight: "900" },
  presetLabelActive: { color: "#1c1207" },
  presetHint: { color: "#5f7da0", fontSize: 10, marginTop: 2 },
  presetHintActive: { color: "rgba(28,18,7,0.75)" },

  overlaysHead: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  bulkWrap: { flexDirection: "row", gap: 8, marginLeft: "auto" },
  bulkBtn: { backgroundColor: "#16263d", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 6 },
  bulkText: { color: "#9fb3cc", fontSize: 12, fontWeight: "700" },

  group: { marginBottom: 18 },
  groupTitle: {
    color: "#5f7da0",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#0b1729",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowLast: { borderBottomWidth: 0 },
  rowText: { flex: 1 },
  rowLabel: { color: "#dbe6f3", fontSize: 14, fontWeight: "700" },
  rowLabelOff: { color: "#64748b", textDecorationLine: "line-through" },
  rowHint: { color: "#5f7da0", fontSize: 11, marginTop: 1 },

  footer: { color: "#5f7da0", fontSize: 11, lineHeight: 17, marginTop: 6 },
});
