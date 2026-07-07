import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { computeFreshness, type ParticipantLastLocation } from "@events/contracts";
import { apiFetch } from "../ui/api-client";
import { useSessionStore } from "../security/session-store";

type SortKey = "bib" | "name" | "recent";

const FRESHNESS_COLOR: Record<string, string> = {
  fresh: "#34d399",
  warning: "#fbbf24",
  stale: "#fb923c",
  offline: "#64748b",
};

function timeAgo(iso?: string): string {
  if (!iso) return "no fix yet";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "no fix yet";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function recentMs(p: ParticipantLastLocation): number {
  return p.recordedAt ? new Date(p.recordedAt).getTime() : 0;
}

/**
 * Registered-participant roster for medics: BIB/name/track + last fix preview
 * rows that expand to phone + medical, with sort and group-by-track.
 */
export function ParticipantsScreen({
  onClose,
  onLocate,
  highlight,
  variant = "screen",
}: {
  onClose: () => void;
  /** Center the map on a participant's last known location. */
  onLocate?: (p: ParticipantLastLocation) => void;
  /** Expand + scroll to + flash a participant (their map dot was tapped).
   *  Matched by userId, falling back to BIB. */
  highlight?: { userId?: string; bib?: string; nonce: number } | null;
  /** "sheet" = hosted in the map's bottom drawer: transparent bg, compact
   *  header (no status-bar inset), close chevron points down. */
  variant?: "screen" | "sheet";
}) {
  const [rows, setRows] = useState<ParticipantLastLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Default: freshest fix on top — during a race "who is reporting right now"
  // matters more than roster order (BIB/name are one tap away).
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [sortAsc, setSortAsc] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [flashId, setFlashId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const rowY = useRef<Map<string, number>>(new Map());

  const load = useCallback(async (asRefresh = false) => {
    if (asRefresh) setRefreshing(true);
    try {
      const eventId = useSessionStore.getState().eventId ?? "";
      const data = await apiFetch<ParticipantLastLocation[]>(`/events/${eventId}/participants`);
      setRows(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = (a.name ?? "").localeCompare(b.name ?? "");
      else if (sortKey === "bib") cmp = (Number(a.bibNumber) || 0) - (Number(b.bibNumber) || 0);
      else cmp = recentMs(a) - recentMs(b);
      return cmp * dir;
    });
  }, [rows, sortKey, sortAsc]);

  const groups = useMemo(() => {
    if (!grouped) return null;
    const map = new Map<string, ParticipantLastLocation[]>();
    for (const p of sorted) {
      const key = p.trackLabel || "No track";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.entries());
  }, [sorted, grouped]);

  // React to a highlight request (a participant's map dot was tapped): find them
  // by userId (or BIB), expand the row, un-collapse its track group, scroll to
  // it, and flash it briefly.
  useEffect(() => {
    if (!highlight) return;
    const target = rows.find(
      (p) => (highlight.userId && p.userId === highlight.userId) || (highlight.bib && p.bibNumber === highlight.bib),
    );
    if (!target) return;
    setExpanded(target.userId);
    const groupKey = target.trackLabel || "No track";
    setCollapsed((prev) => {
      if (!prev.has(groupKey)) return prev;
      const next = new Set(prev);
      next.delete(groupKey);
      return next;
    });
    setFlashId(target.userId);
    const t1 = setTimeout(() => {
      // Recorded y is content-relative only in the flat list; skip auto-scroll
      // when grouped (expand + flash still draw attention).
      const y = rowY.current.get(target.userId);
      if (!grouped && y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 90), animated: true });
    }, 120);
    const t2 = setTimeout(() => setFlashId(null), 1600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight?.nonce, rows.length]);

  const toggleSort = (key: SortKey) => {
    void Haptics.selectionAsync();
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      // "Last fix" starts descending (latest fixes on top); text/number keys ascending.
      setSortAsc(key !== "recent");
    }
  };

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => {
    const active = sortKey === k;
    return (
      <Pressable
        onPress={() => toggleSort(k)}
        style={[styles.sortBtn, active && styles.sortBtnActive]}
      >
        <Text style={[styles.sortBtnText, active && styles.sortBtnTextActive]}>{label}</Text>
        {active ? (
          <Feather name={sortAsc ? "arrow-up" : "arrow-down"} size={12} color="#e8eef7" />
        ) : null}
      </Pressable>
    );
  };

  const inSheet = variant === "sheet";

  return (
    <View style={[styles.root, inSheet && styles.rootSheet]}>
      {/* Header */}
      <View style={[styles.header, inSheet && styles.headerSheet]}>
        <Pressable style={styles.backBtn} onPress={onClose} hitSlop={8}>
          <Feather name={inSheet ? "chevron-down" : "arrow-left"} size={20} color="#e8eef7" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Participants</Text>
          <Text style={styles.subtitle}>
            {rows.length} registered{loading ? " · loading…" : ""}
          </Text>
        </View>
        <View style={styles.headerBadge}>
          <Feather name="users" size={17} color="#34d399" />
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <Text style={styles.controlsLabel}>SORT</Text>
        <SortBtn k="bib" label="BIB" />
        <SortBtn k="name" label="Name" />
        <SortBtn k="recent" label="Last fix" />
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => setGrouped((v) => !v)}
          style={[styles.groupBtn, grouped && styles.groupBtnActive]}
        >
          <Feather name="layers" size={13} color={grouped ? "#e8eef7" : "#7e93ad"} />
          <Text style={[styles.groupBtnText, grouped && styles.sortBtnTextActive]}>Track</Text>
        </Pressable>
      </View>

      {loading && rows.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color="#34d399" />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#34d399" />}
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {rows.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="users" size={30} color="#334155" />
              <Text style={styles.emptyTitle}>No registered participants yet</Text>
              <Text style={styles.emptySub}>Runners appear here once they register in the app.</Text>
            </View>
          ) : grouped && groups ? (
            groups.map(([key, list]) => {
              const isCollapsed = collapsed.has(key);
              return (
                <View key={key} style={styles.group}>
                  <Pressable style={styles.groupHeader} onPress={() => toggleGroup(key)}>
                    <Feather name={isCollapsed ? "chevron-right" : "chevron-down"} size={16} color="#7e93ad" />
                    <Text style={styles.groupTitle}>{key}</Text>
                    <Text style={styles.groupCount}>{list.length}</Text>
                  </Pressable>
                  {!isCollapsed
                    ? list.map((p) => (
                        <Row
                          key={p.userId}
                          p={p}
                          open={expanded === p.userId}
                          flash={flashId === p.userId}
                          onLayoutY={(y) => rowY.current.set(p.userId, y)}
                          onToggle={() => setExpanded((id) => (id === p.userId ? null : p.userId))}
                          onLocate={onLocate}
                        />
                      ))
                    : null}
                </View>
              );
            })
          ) : (
            sorted.map((p) => (
              <Row
                key={p.userId}
                p={p}
                open={expanded === p.userId}
                flash={flashId === p.userId}
                onLayoutY={(y) => rowY.current.set(p.userId, y)}
                onToggle={() => setExpanded((id) => (id === p.userId ? null : p.userId))}
                onLocate={onLocate}
              />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Row({ p, open, flash, onLayoutY, onToggle, onLocate }: {
  p: ParticipantLastLocation;
  open: boolean;
  flash?: boolean;
  onLayoutY?: (y: number) => void;
  onToggle: () => void;
  onLocate?: (p: ParticipantLastLocation) => void;
}) {
  // Derive freshness live from the fix timestamp on every render (matching
  // timeAgo's live "ago" text) rather than trusting `p.freshness`, which is
  // computed once server-side at fetch time and goes stale between polls or
  // when a live update patches lat/lng/recordedAt without recomputing it.
  const dot = FRESHNESS_COLOR[computeFreshness(p.recordedAt)] ?? "#64748b";
  const hasMedical = Boolean(p.allergies || p.medications || p.bloodType || p.conditions);
  const hasLocation = p.lat != null && p.lng != null;

  return (
    <View
      style={[styles.row, open && styles.rowOpen, flash && styles.rowFlash]}
      onLayout={onLayoutY ? (e) => onLayoutY(e.nativeEvent.layout.y) : undefined}
    >
      <Pressable style={styles.rowPreview} onPress={onToggle}>
        <View style={styles.bib}>
          <Text style={styles.bibText}>{p.bibNumber ?? "—"}</Text>
        </View>
        <View style={styles.rowMain}>
          <View style={styles.rowNameLine}>
            <Text style={styles.rowName} numberOfLines={1}>{p.name || "Unknown"}</Text>
            {hasMedical ? <Feather name="alert-triangle" size={12} color="#fbbf24" /> : null}
          </View>
          <View style={styles.rowMetaLine}>
            {p.trackLabel ? <Text style={styles.trackChip}>{p.trackLabel}</Text> : null}
            <Feather name="clock" size={10} color="#64748b" />
            <Text style={styles.rowMeta}>{timeAgo(p.recordedAt)}</Text>
          </View>
        </View>
        <View style={[styles.freshDot, { backgroundColor: dot }]} />
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color="#475569" />
      </Pressable>

      {open ? (
        <View style={styles.detail}>
          {p.phone ? (
            <Pressable style={styles.phoneRow} onPress={() => void Linking.openURL(`tel:${p.phone}`)}>
              <Feather name="phone" size={13} color="#34d399" />
              <Text style={styles.phoneText}>{p.phone}</Text>
            </Pressable>
          ) : (
            <View style={styles.phoneRow}>
              <Feather name="phone" size={13} color="#475569" />
              <Text style={styles.noPhone}>No phone on file</Text>
            </View>
          )}
          {hasMedical ? (
            <View style={styles.chipRow}>
              {p.bloodType ? <Text style={[styles.chip, styles.bloodChip]} numberOfLines={1}>🩸 {p.bloodType}</Text> : null}
              {p.allergies ? <Text style={[styles.chip, styles.allergyChip]} numberOfLines={1}>⚠ {p.allergies}</Text> : null}
              {p.medications ? <Text style={[styles.chip, styles.medsChip]} numberOfLines={1}>💊 {p.medications}</Text> : null}
              {p.conditions ? <Text style={[styles.chip, styles.conditionChip]} numberOfLines={1}>🩺 {p.conditions}</Text> : null}
            </View>
          ) : null}
          <View style={styles.detailMeta}>
            {hasLocation ? (
              <Text style={styles.detailMetaText}>
                <Feather name="map-pin" size={10} color="#64748b" /> {p.lat!.toFixed(5)}, {p.lng!.toFixed(5)}
                {p.accuracy != null ? ` (±${Math.round(p.accuracy)}m)` : ""}
              </Text>
            ) : null}
            <Text style={styles.detailMetaText}>
              {p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleTimeString() : "—"}
            </Text>
          </View>
          {hasLocation && onLocate ? (
            <Pressable style={styles.locateBtn} onPress={() => onLocate(p)}>
              <Feather name="crosshair" size={13} color="#34d399" />
              <Text style={styles.locateBtnText}>Show on map</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#070d17" },
  // Hosted in the map bottom drawer — the sheet supplies its own background.
  rootSheet: { backgroundColor: "transparent" },
  headerSheet: { paddingTop: 2 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.08)",
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  headerText: { flex: 1 },
  title: { color: "#f4f8ff", fontSize: 20, fontWeight: "900" },
  subtitle: { color: "#7e93ad", fontSize: 12.5, fontWeight: "600", marginTop: 1 },
  headerBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(52,211,153,0.12)",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.06)",
  },
  controlsLabel: { color: "#475569", fontSize: 10, fontWeight: "800", letterSpacing: 1, marginRight: 1 },
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.08)",
  },
  sortBtnActive: { backgroundColor: "rgba(52,211,153,0.14)", borderColor: "rgba(52,211,153,0.3)" },
  sortBtnText: { color: "#7e93ad", fontSize: 12, fontWeight: "700" },
  sortBtnTextActive: { color: "#e8eef7" },
  groupBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.08)",
  },
  groupBtnActive: { backgroundColor: "rgba(59,130,246,0.16)", borderColor: "rgba(59,130,246,0.32)" },
  groupBtnText: { color: "#7e93ad", fontSize: 12, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 12, gap: 6, paddingBottom: 40 },
  error: { color: "#f87171", fontSize: 12, marginBottom: 8 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 60 },
  emptyTitle: { color: "#64748b", fontSize: 14, fontWeight: "700" },
  emptySub: { color: "#475569", fontSize: 12 },
  group: { marginBottom: 6 },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 8, paddingHorizontal: 4 },
  groupTitle: { color: "#cbd5e1", fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  groupCount: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "700",
    backgroundColor: "rgba(148,163,184,0.14)",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  row: {
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.07)",
    marginBottom: 6,
    overflow: "hidden",
  },
  rowOpen: { borderColor: "rgba(52,211,153,0.28)" },
  rowFlash: { borderColor: "#34d399", backgroundColor: "rgba(52,211,153,0.12)" },
  rowPreview: { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 11, paddingVertical: 10 },
  bib: {
    minWidth: 44,
    height: 34,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(52,211,153,0.1)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.18)",
  },
  bibText: { color: "#34d399", fontSize: 14, fontWeight: "900" },
  rowMain: { flex: 1, minWidth: 0 },
  rowNameLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowName: { color: "#e2e8f0", fontSize: 14.5, fontWeight: "700", flexShrink: 1 },
  rowMetaLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  trackChip: {
    color: "#60a5fa",
    fontSize: 10,
    fontWeight: "800",
    backgroundColor: "rgba(59,130,246,0.14)",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
    overflow: "hidden",
    textTransform: "uppercase",
  },
  rowMeta: { color: "#64748b", fontSize: 11 },
  freshDot: { width: 10, height: 10, borderRadius: 5 },
  detail: {
    paddingHorizontal: 11,
    paddingBottom: 11,
    paddingTop: 8,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(148,163,184,0.07)",
  },
  phoneRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  phoneText: { color: "#34d399", fontSize: 14, fontWeight: "800" },
  noPhone: { color: "#475569", fontSize: 13 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { fontSize: 11.5, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: "hidden", maxWidth: "100%" },
  allergyChip: { backgroundColor: "rgba(239,68,68,0.16)", color: "#fca5a5" },
  medsChip: { backgroundColor: "rgba(168,85,247,0.16)", color: "#c4b5fd" },
  bloodChip: { backgroundColor: "rgba(239,68,68,0.22)", color: "#fca5a5" },
  conditionChip: { backgroundColor: "rgba(245,158,11,0.16)", color: "#fcd34d" },
  detailMeta: { flexDirection: "row", alignItems: "center", gap: 14 },
  detailMetaText: { color: "#64748b", fontSize: 11 },
  locateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 2,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: "rgba(52,211,153,0.12)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.24)",
  },
  locateBtnText: { color: "#34d399", fontSize: 13, fontWeight: "800" },
});
