import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { boundsSpanKm, estimateMb, tileCountForBounds } from "./offline-tiles";

export interface OfflineQuality {
  key: string;
  label: string;
  sublabel: string;
  minZoom: number;
  maxZoom: number;
}

/** Ordered low → high resolution; the index IS the quality rank. */
const QUALITIES: OfflineQuality[] = [
  { key: "fast", label: "Fast", sublabel: "Overview · streets & area", minZoom: 9, maxZoom: 13 },
  { key: "balanced", label: "Balanced", sublabel: "Recommended · most detail", minZoom: 9, maxZoom: 15 },
  { key: "detailed", label: "Detailed", sublabel: "Full zoom · large & slow", minZoom: 12, maxZoom: 16 },
];

function rankOf(key: string | null): number {
  if (!key) return -1;
  const i = QUALITIES.findIndex((q) => q.key === key);
  return i;
}

function fmtMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 100) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

interface Props {
  visible: boolean;
  bounds: [number, number, number, number] | null;
  tileSize: number;
  /** Quality already on disk, or null when nothing is saved. */
  savedQualityKey: string | null;
  onClose: () => void;
  onConfirm: (quality: OfflineQuality) => void;
  /** Delete the saved pack. */
  onRemove: () => void;
}

export function OfflineDownloadModal({
  visible,
  bounds,
  tileSize,
  savedQualityKey,
  onClose,
  onConfirm,
  onRemove,
}: Props) {
  const savedRank = rankOf(savedQualityKey);
  // Only higher resolutions are worth downloading — the saved one and anything
  // below it is already covered by what's on disk.
  const upgrades = QUALITIES.filter((_, i) => i > savedRank);
  const [selected, setSelected] = useState(upgrades[0]?.key ?? "balanced");

  // Re-seat the selection whenever the sheet opens: the saved quality may have
  // changed since last time, and a disabled row must never stay selected.
  useEffect(() => {
    if (!visible) return;
    const preferred = upgrades.find((q) => q.key === "balanced") ?? upgrades[0];
    setSelected(preferred?.key ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, savedQualityKey]);

  const span = useMemo(() => (bounds ? boundsSpanKm(bounds) : null), [bounds]);
  const estimates = useMemo(() => {
    if (!bounds) return {} as Record<string, { tiles: number; mb: number }>;
    const out: Record<string, { tiles: number; mb: number }> = {};
    for (const q of QUALITIES) {
      const tiles = tileCountForBounds(bounds, q.minZoom, q.maxZoom);
      out[q.key] = { tiles, mb: estimateMb(tiles, tileSize) };
    }
    return out;
  }, [bounds, tileSize]);

  const chosen = QUALITIES.find((q) => q.key === selected) ?? null;
  const chosenEst = chosen ? estimates[chosen.key] : undefined;
  const nothingLeft = upgrades.length === 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Feather name="download-cloud" size={20} color="#60a5fa" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{savedQualityKey ? "Offline map saved" : "Download offline map"}</Text>
              <Text style={styles.subtitle}>Used automatically when you lose signal</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={22} color="#64748b" />
            </Pressable>
          </View>

          {/* Area being cached */}
          <View style={styles.areaBox}>
            <Feather name="map" size={15} color="#94a3b8" />
            <Text style={styles.areaText}>
              {span
                ? `Event area — ~${span.widthKm.toFixed(1)} × ${span.heightKm.toFixed(1)} km around the tracks`
                : "Open the map with the event tracks loaded first."}
            </Text>
          </View>

          {/* Quality options. Only the resolution actually on disk is green;
              anything below it is implied by that pack, so it greys out. Both
              are unselectable — only higher resolutions are offered. */}
          <Text style={styles.sectionLabel}>QUALITY</Text>
          {QUALITIES.map((q, i) => {
            const est = estimates[q.key];
            const isSaved = q.key === savedQualityKey;
            // Below the saved pack: already implied by it, so nothing to download.
            const superseded = i < savedRank;
            const covered = isSaved || superseded;
            const active = !covered && q.key === selected;
            return (
              <Pressable
                key={q.key}
                style={[
                  styles.option,
                  active && styles.optionActive,
                  isSaved && styles.optionSaved,
                  superseded && styles.optionSuperseded,
                ]}
                onPress={() => !covered && setSelected(q.key)}
                disabled={covered}
              >
                {covered ? (
                  <View style={[styles.savedCheck, superseded && styles.supersededCheck]}>
                    <Feather name="check" size={12} color={superseded ? "#64748b" : "#04121f"} />
                  </View>
                ) : (
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active ? <View style={styles.radioDot} /> : null}
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.optionLabel,
                      active && { color: "#e2e8f0" },
                      isSaved && { color: "#34d399" },
                      superseded && { color: "#64748b" },
                    ]}
                  >
                    {q.label}
                  </Text>
                  <Text
                    style={[
                      styles.optionSub,
                      isSaved && { color: "#3f8f74" },
                      superseded && { color: "#475569" },
                    ]}
                  >
                    {isSaved ? "Saved on this device" : superseded ? "Already covered" : q.sublabel}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  {covered ? (
                    <Feather name="hard-drive" size={15} color={superseded ? "#475569" : "#34d399"} />
                  ) : (
                    <>
                      <Text style={[styles.optionSize, active && { color: "#60a5fa" }]}>
                        {est ? fmtMb(est.mb) : "—"}
                      </Text>
                      <Text style={styles.optionTiles}>{est ? `${est.tiles.toLocaleString()} tiles` : ""}</Text>
                    </>
                  )}
                </View>
              </Pressable>
            );
          })}

          {nothingLeft ? (
            <View style={styles.doneBox}>
              <Feather name="check-circle" size={13} color="#34d399" />
              <Text style={styles.doneText}>
                The highest resolution is already saved — nothing left to download.
              </Text>
            </View>
          ) : chosenEst && chosenEst.mb > 250 ? (
            <View style={styles.warnBox}>
              <Feather name="alert-triangle" size={13} color="#fbbf24" />
              <Text style={styles.warnText}>
                Large download — the lower quality is quicker and much smaller.
              </Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            {savedQualityKey ? (
              <Pressable style={[styles.btn, styles.removeBtn]} onPress={onRemove}>
                <Feather name="trash-2" size={15} color="#fca5a5" />
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            ) : (
              <Pressable style={[styles.btn, styles.cancelBtn]} onPress={onClose}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.btn, styles.confirmBtn, (!bounds || !chosen) && styles.btnDisabled]}
              onPress={() => bounds && chosen && onConfirm(chosen)}
              disabled={!bounds || !chosen}
            >
              <Feather name="download" size={15} color="#04121f" />
              <Text style={styles.confirmText}>
                {savedQualityKey ? "Upgrade" : "Download"}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 8, 18, 0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "rgba(10, 17, 31, 0.99)",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    padding: 18,
    gap: 12,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: "rgba(59,130,246,0.14)",
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: "#f1f5f9", fontSize: 17, fontWeight: "900" },
  subtitle: { color: "#64748b", fontSize: 12, fontWeight: "600", marginTop: 1 },
  areaBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    padding: 11,
  },
  areaText: { color: "#cbd5e1", fontSize: 12, fontWeight: "600", flex: 1, lineHeight: 17 },
  sectionLabel: { color: "#475569", fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginTop: 2 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  optionActive: { borderColor: "rgba(59,130,246,0.5)", backgroundColor: "rgba(59,130,246,0.08)" },
  optionSaved: { borderColor: "rgba(52,211,153,0.45)", backgroundColor: "rgba(52,211,153,0.08)" },
  optionSuperseded: { borderColor: "rgba(148,163,184,0.1)", backgroundColor: "rgba(255,255,255,0.015)" },
  savedCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#34d399",
    alignItems: "center",
    justifyContent: "center",
  },
  supersededCheck: { backgroundColor: "rgba(148,163,184,0.16)" },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "rgba(148,163,184,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  radioActive: { borderColor: "#60a5fa" },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#60a5fa" },
  optionLabel: { color: "#cbd5e1", fontSize: 14, fontWeight: "800" },
  optionSub: { color: "#64748b", fontSize: 11, fontWeight: "600", marginTop: 1 },
  optionSize: { color: "#94a3b8", fontSize: 14, fontWeight: "900" },
  optionTiles: { color: "#475569", fontSize: 10, fontWeight: "600", marginTop: 1 },
  warnBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(245,158,11,0.1)",
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  warnText: { color: "#fcd34d", fontSize: 11, fontWeight: "700", flex: 1 },
  doneBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(52,211,153,0.1)",
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  doneText: { color: "#6ee7b7", fontSize: 11, fontWeight: "700", flex: 1 },
  removeBtn: { backgroundColor: "rgba(239,68,68,0.12)", borderWidth: 1, borderColor: "rgba(239,68,68,0.3)" },
  removeText: { color: "#fca5a5", fontSize: 14, fontWeight: "800" },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 13, borderRadius: 14 },
  cancelBtn: { backgroundColor: "rgba(255,255,255,0.05)" },
  cancelText: { color: "#94a3b8", fontSize: 14, fontWeight: "800" },
  confirmBtn: { backgroundColor: "#60a5fa" },
  confirmText: { color: "#04121f", fontSize: 14, fontWeight: "900" },
  btnDisabled: { opacity: 0.5 },
});
