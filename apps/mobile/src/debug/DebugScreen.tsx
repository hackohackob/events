import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { type DebugCategory, type DebugLevel, useDebugLog } from "./debug-log";
import { MapDebugSettings } from "./MapDebugSettings";
import { mapDebugDirtyCount, useMapDebug } from "./map-debug";

type Filter = DebugCategory | "all" | "errors";
// "errors" is a cross-category filter (level === "error"), kept first after
// "all" so it's the quickest thing to reach when something's wrong.
const CATEGORIES: Array<Filter> = ["all", "errors", "location", "api", "socket", "incident", "app"];

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
  const [filter, setFilter] = useState<Filter>("all");
  // Field diagnosis for "the map won't pan / the drawer ignores my finger":
  // a separate view, so nothing about the log screen changes when it is off.
  const [tool, setTool] = useState<"log" | "settings">("log");
  const [menuOpen, setMenuOpen] = useState(false);
  const hidden = useMapDebug((s) => s.hidden);
  const mapZIndex = useMapDebug((s) => s.mapZIndex);
  const mapDebugDirty = mapDebugDirtyCount(hidden, mapZIndex);

  const visible = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "errors") return entries.filter((e) => e.level === "error");
    return entries.filter((e) => e.category === filter);
  }, [entries, filter]);

  const errorCount = useMemo(() => entries.filter((e) => e.level === "error").length, [entries]);

  const copyAll = async () => {
    const text = entries
      .slice()
      .reverse()
      .map((e) => `${formatTime(e.at)} [${e.category}/${e.level}] ${e.message}${e.detail ? ` — ${e.detail}` : ""}`)
      .join("\n");
    await Share.share({ message: text || "(empty debug log)" });
  };

  if (tool === "settings") return <MapDebugSettings onClose={() => setTool("log")} />;

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
          {mapDebugDirty > 0 ? (
            <Pressable style={styles.dirtyPill} onPress={() => setTool("settings")}>
              <Text style={styles.dirtyPillText}>{mapDebugDirty} changed</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.menuBtn} onPress={() => setMenuOpen(o => !o)} hitSlop={8}>
            <Feather name={menuOpen ? "x" : "more-vertical"} size={20} color="#cbd5e1" />
          </Pressable>
        </View>
      </View>

      {menuOpen ? (
        <>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />
          <View style={styles.menu}>
            <MenuItem
              icon="sliders"
              label="Map settings"
              hint="Overlays and map layer"
              onPress={() => {
                setMenuOpen(false);
                setTool("settings");
              }}
            />
            <MenuItem
              icon="share"
              label="Share log"
              hint={`${entries.length} entries`}
              onPress={() => {
                setMenuOpen(false);
                void copyAll();
              }}
            />
            <MenuItem
              icon="trash-2"
              label="Clear log"
              hint="Wipes what is listed below"
              destructive
              onPress={() => {
                setMenuOpen(false);
                clear();
              }}
            />
          </View>
        </>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={styles.filterBarContent}>
        {CATEGORIES.map((cat) => {
          const active = filter === cat;
          const isErrors = cat === "errors";
          const label = isErrors && errorCount > 0 ? `errors (${errorCount})` : cat;
          return (
            <Pressable
              key={cat}
              style={[
                styles.chip,
                active && styles.chipActive,
                isErrors && styles.chipError,
                isErrors && active && styles.chipErrorActive,
              ]}
              onPress={() => setFilter(cat)}
            >
              <Text
                style={[
                  styles.chipText,
                  active && styles.chipTextActive,
                  isErrors && styles.chipErrorText,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
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

function MenuItem({
  icon,
  label,
  hint,
  destructive = false,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  hint: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.menuItem} onPress={onPress}>
      <Feather name={icon} size={17} color={destructive ? "#f87171" : "#34d399"} />
      <View style={styles.menuItemText}>
        <Text style={[styles.menuItemLabel, destructive && styles.menuItemLabelDestructive]}>{label}</Text>
        <Text style={styles.menuItemHint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  dirtyPill: { backgroundColor: "#f59e0b", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  dirtyPillText: { color: "#1c1207", fontSize: 11, fontWeight: "900" },
  menuBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 20 },
  menu: {
    position: "absolute",
    top: 58,
    right: 14,
    zIndex: 21,
    minWidth: 232,
    backgroundColor: "#0b1729",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  menuItemText: { flex: 1 },
  menuItemLabel: { color: "#dbe6f3", fontSize: 14, fontWeight: "800" },
  menuItemLabelDestructive: { color: "#f87171" },
  menuItemHint: { color: "#5f7da0", fontSize: 11, marginTop: 1 },
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
  chipError: { borderColor: "rgba(255,107,107,0.4)" },
  chipErrorActive: { backgroundColor: "#3a1620", borderColor: "#ff6b6b" },
  chipText: { color: "#7c8a9c", fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#bfdbfe" },
  chipErrorText: { color: "#ff8d8d" },
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
