import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { apiFetch } from "../ui/api-client";
import { debugLog } from "../debug/debug-log";

export interface FieldGuideCase {
  id: string;
  title: string;
  category: string;
  keywords: string[];
  summary: string;
  signs: string[];
  actions: string[];
  redFlags: string[];
  updatedAt: string;
}

const CATEGORY_META: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  cardiac: { label: "Cardiac", color: "#f87171", icon: "heart" },
  neuro: { label: "Neuro", color: "#c084fc", icon: "zap" },
  metabolic: { label: "Metabolic", color: "#fbbf24", icon: "droplet" },
  environmental: { label: "Environment", color: "#38bdf8", icon: "thermometer" },
  trauma: { label: "Trauma", color: "#fb923c", icon: "alert-octagon" },
  airway: { label: "Airway", color: "#34d399", icon: "wind" },
  allergy: { label: "Allergy", color: "#f472b6", icon: "alert-triangle" },
  other: { label: "Other", color: "#94a3b8", icon: "book-open" },
};

function categoryMeta(category: string) {
  return CATEGORY_META[category] ?? CATEGORY_META.other;
}

/**
 * Searchable in-field reference of emergency cases — quick "how do I act"
 * reminders for medics. Content comes from the backend field guide (editable
 * on the dashboard) and is cached in memory for the session.
 */
export function FieldGuideScreen({ onClose }: { onClose: () => void }) {
  const [cases, setCases] = useState<FieldGuideCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async (asRefresh = false) => {
    if (asRefresh) setRefreshing(true);
    try {
      const list = await apiFetch<FieldGuideCase[]>("/field-guide");
      setCases(list);
      setError(null);
    } catch (err) {
      debugLog("api", "error", "field guide load failed", String(err));
      setError("Could not load the field guide. Pull to retry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const categories = useMemo(() => {
    const seen = new Set(cases.map((c) => c.category));
    return Object.keys(CATEGORY_META).filter((key) => seen.has(key));
  }, [cases]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    return cases
      .map((c) => {
        if (category && c.category !== category) return null;
        if (!q) return { c, score: 0 };
        // Search across everything a symptom might be phrased as — title,
        // summary, keywords, signs, actions and red flags — so one symptom term
        // surfaces every relevant case. Every typed word must hit somewhere.
        const title = c.title.toLowerCase();
        const keywords = c.keywords.join(" ").toLowerCase();
        const haystack = [
          title,
          c.summary,
          c.category,
          keywords,
          ...c.signs,
          ...c.actions,
          ...c.redFlags,
        ]
          .join(" ")
          .toLowerCase();
        if (!words.every((w) => haystack.includes(w))) return null;
        // Rank: title/keyword hits first, then the rest.
        const score = words.reduce(
          (s, w) => s + (title.includes(w) ? 3 : 0) + (keywords.includes(w) ? 2 : 0) + 1,
          0,
        );
        return { c, score };
      })
      .filter((x): x is { c: FieldGuideCase; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
  }, [cases, query, category]);

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onClose} hitSlop={8}>
          <Feather name="arrow-left" size={20} color="#e8eef7" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Field Guide</Text>
          <Text style={styles.subtitle}>Quick action reminders · {cases.length} cases</Text>
        </View>
        <View style={styles.headerBadge}>
          <Feather name="book-open" size={17} color="#34d399" />
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Feather name="search" size={16} color="#64748b" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search symptoms — chest pain, dizzy, swelling…"
          placeholderTextColor="#475569"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <Feather name="x-circle" size={16} color="#64748b" />
          </Pressable>
        ) : null}
      </View>

      {/* Category chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chipsRow}>
        <Pressable
          style={[styles.chip, category === null && styles.chipActive]}
          onPress={() => setCategory(null)}
        >
          <Text style={[styles.chipText, category === null && styles.chipTextActive]}>All</Text>
        </Pressable>
        {categories.map((key) => {
          const meta = categoryMeta(key);
          const active = category === key;
          return (
            <Pressable
              key={key}
              style={[styles.chip, active && { backgroundColor: `${meta.color}26`, borderColor: `${meta.color}88` }]}
              onPress={() => setCategory(active ? null : key)}
            >
              <Feather name={meta.icon} size={12} color={active ? meta.color : "#64748b"} />
              <Text style={[styles.chipText, active && { color: meta.color }]}>{meta.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Results */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#34d399" />
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor="#34d399" />}
          keyboardShouldPersistTaps="handled"
        >
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {!error && results.length === 0 ? (
            <View style={styles.center}>
              <Feather name="search" size={28} color="#334155" />
              <Text style={styles.emptyText}>Nothing matches "{query}".</Text>
            </View>
          ) : null}
          {results.map((item) => {
            const meta = categoryMeta(item.category);
            const open = openId === item.id;
            return (
              <Pressable
                key={item.id}
                style={[styles.card, open && { borderColor: `${meta.color}66` }]}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setOpenId(open ? null : item.id);
                }}
              >
                <View style={styles.cardHeader}>
                  <View style={[styles.cardIcon, { backgroundColor: `${meta.color}1f`, borderColor: `${meta.color}55` }]}>
                    <Feather name={meta.icon} size={17} color={meta.color} />
                  </View>
                  <View style={styles.cardText}>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Text style={styles.cardSummary} numberOfLines={open ? undefined : 2}>
                      {item.summary}
                    </Text>
                  </View>
                  <Feather name={open ? "chevron-up" : "chevron-down"} size={17} color="#475569" />
                </View>

                {open ? (
                  <View style={styles.detail}>
                    {item.signs.length > 0 ? (
                      <View style={styles.detailSection}>
                        <Text style={[styles.detailKicker, { color: "#93c5fd" }]}>RECOGNIZE</Text>
                        {item.signs.map((sign, i) => (
                          <View key={i} style={styles.detailRow}>
                            <View style={[styles.detailDot, { backgroundColor: "#3b82f6" }]} />
                            <Text style={styles.detailText}>{sign}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {item.actions.length > 0 ? (
                      <View style={styles.detailSection}>
                        <Text style={[styles.detailKicker, { color: "#34d399" }]}>DO</Text>
                        {item.actions.map((action, i) => (
                          <View key={i} style={styles.detailRow}>
                            <View style={styles.stepBadge}>
                              <Text style={styles.stepBadgeText}>{i + 1}</Text>
                            </View>
                            <Text style={styles.detailText}>{action}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {item.redFlags.length > 0 ? (
                      <View style={[styles.detailSection, styles.redFlagBox]}>
                        <Text style={[styles.detailKicker, { color: "#f87171" }]}>RED FLAGS</Text>
                        {item.redFlags.map((flag, i) => (
                          <View key={i} style={styles.detailRow}>
                            <Feather name="alert-triangle" size={11} color="#f87171" style={{ marginTop: 3 }} />
                            <Text style={[styles.detailText, { color: "#fecaca" }]}>{flag}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
          <Text style={styles.footerNote}>
            Reference reminders only — follow your training and local protocols.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#020b18" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1 },
  title: { color: "#f4f8ff", fontSize: 21, fontWeight: "900", letterSpacing: 0.2 },
  subtitle: { color: "#64748b", fontSize: 12, fontWeight: "700", marginTop: 1 },
  headerBadge: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "rgba(34,197,94,0.1)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginHorizontal: 16,
    marginTop: 4,
    paddingHorizontal: 13,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  searchInput: { flex: 1, color: "#e8eef7", fontSize: 14, paddingVertical: 11 },
  chipsScroll: { flexGrow: 0, marginTop: 11 },
  chipsRow: { paddingHorizontal: 16, gap: 7 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  chipActive: { backgroundColor: "rgba(52,211,153,0.14)", borderColor: "rgba(52,211,153,0.6)" },
  chipText: { color: "#8da3bd", fontSize: 12, fontWeight: "800" },
  chipTextActive: { color: "#34d399" },
  list: { flex: 1, marginTop: 10 },
  listContent: { paddingHorizontal: 16, paddingBottom: 90, gap: 9 },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 10 },
  errorText: { color: "#fca5a5", fontSize: 13, textAlign: "center", paddingVertical: 14 },
  emptyText: { color: "#475569", fontSize: 13, fontWeight: "600" },
  card: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
    padding: 13,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: { flex: 1, minWidth: 0 },
  cardTitle: { color: "#f0f5fc", fontSize: 15.5, fontWeight: "900" },
  cardSummary: { color: "#7d8ea4", fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  detail: { marginTop: 12, gap: 12 },
  detailSection: { gap: 6 },
  detailKicker: { fontSize: 10, fontWeight: "900", letterSpacing: 1.3 },
  detailRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  detailDot: { width: 5, height: 5, borderRadius: 3, marginTop: 6 },
  detailText: { flex: 1, color: "#cdd9e8", fontSize: 13, lineHeight: 18 },
  stepBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(34,197,94,0.16)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.45)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 0.5,
  },
  stepBadgeText: { color: "#34d399", fontSize: 10, fontWeight: "900" },
  redFlagBox: {
    backgroundColor: "rgba(239,68,68,0.07)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
    padding: 10,
  },
  footerNote: { color: "#3d4a5c", fontSize: 11, textAlign: "center", marginTop: 14, fontStyle: "italic" },
});
