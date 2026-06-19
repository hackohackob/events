import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { type DebugCategory, type DebugLevel, useDebugLog } from "./debug-log";

const CATEGORIES: Array<DebugCategory | "all"> = ["all", "location", "api", "socket", "incident", "app"];

const LEVEL_COLOR: Record<DebugLevel, string> = {
  info: "#7c8a9c",
  warn: "#f5c518",
  error: "#ff6b6b",
};

const CAT_COLOR: Record<DebugCategory, string> = {
  location: "#22ff88",
  api: "#60a5fa",
  socket: "#a78bfa",
  incident: "#ff9f40",
  app: "#94a3b8",
};

function formatTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function DebugScreen({ onClose }: { onClose?: () => void }) {
  const entries = useDebugLog((s) => s.entries);
  const clear = useDebugLog((s) => s.clear);
  const [filter, setFilter] = useState<DebugCategory | "all">("all");

  const visible = useMemo(
    () => (filter === "all" ? entries : entries.filter((e) => e.category === filter)),
    [entries, filter],
  );

  const copyAll = async () => {
    const text = entries
      .slice()
      .reverse()
      .map((e) => `${formatTime(e.at)} [${e.category}/${e.level}] ${e.message}${e.detail ? ` — ${e.detail}` : ""}`)
      .join("\n");
    await Share.share({ message: text || "(empty debug log)" });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {onClose ? (
          <Pressable style={styles.backBtn} onPress={onClose} hitSlop={10}>
            <Feather name="chevron-left" size={22} color="#cbd5e1" />
          </Pressable>
        ) : null}
        <Text style={styles.heading}>Debug log</Text>
        <View style={styles.headerActions}>
          <Pressable style={styles.smallBtn} onPress={() => void copyAll()}>
            <Text style={styles.smallBtnText}>Share</Text>
          </Pressable>
          <Pressable style={styles.smallBtn} onPress={clear}>
            <Text style={styles.smallBtnText}>Clear</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={styles.filterBarContent}>
        {CATEGORIES.map((cat) => (
          <Pressable
            key={cat}
            style={[styles.chip, filter === cat && styles.chipActive]}
            onPress={() => setFilter(cat)}
          >
            <Text style={[styles.chipText, filter === cat && styles.chipTextActive]}>{cat}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {visible.length === 0 ? (
          <Text style={styles.empty}>No log entries yet.</Text>
        ) : (
          visible.map((e) => (
            <View key={e.id} style={styles.entry}>
              <View style={styles.entryHead}>
                <Text style={styles.entryTime}>{formatTime(e.at)}</Text>
                <View style={[styles.catDot, { backgroundColor: CAT_COLOR[e.category] }]} />
                <Text style={[styles.entryCat, { color: CAT_COLOR[e.category] }]}>{e.category}</Text>
                <Text style={[styles.entryLevel, { color: LEVEL_COLOR[e.level] }]}>{e.level}</Text>
              </View>
              <Text style={styles.entryMsg}>{e.message}</Text>
              {e.detail ? <Text style={styles.entryDetail}>{e.detail}</Text> : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020b18" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  heading: { color: "#eff6ff", fontSize: 20, fontWeight: "900" },
  headerActions: { flexDirection: "row", gap: 8, marginLeft: "auto" },
  smallBtn: { backgroundColor: "#16263d", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  smallBtnText: { color: "#9fb3cc", fontSize: 12, fontWeight: "700" },
  filterBar: { maxHeight: 44, flexGrow: 0 },
  filterBarContent: { paddingHorizontal: 12, gap: 8, alignItems: "center" },
  chip: { backgroundColor: "#0b1729", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: "rgba(148,163,184,0.12)" },
  chipActive: { backgroundColor: "#1e3a5f", borderColor: "#3b82f6" },
  chipText: { color: "#7c8a9c", fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#bfdbfe" },
  list: { flex: 1 },
  listContent: { padding: 12, paddingBottom: 40 },
  empty: { color: "#5f7da0", fontSize: 13, textAlign: "center", marginTop: 40 },
  entry: { backgroundColor: "#0b1729", borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: "rgba(148,163,184,0.08)" },
  entryHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  entryTime: { color: "#5f7da0", fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  catDot: { width: 7, height: 7, borderRadius: 4 },
  entryCat: { fontSize: 11, fontWeight: "800" },
  entryLevel: { fontSize: 10, fontWeight: "800", marginLeft: "auto", textTransform: "uppercase" },
  entryMsg: { color: "#dbe6f3", fontSize: 13, fontWeight: "600" },
  entryDetail: { color: "#6b7f9a", fontSize: 11, marginTop: 3, fontFamily: "monospace" },
});
