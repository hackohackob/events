import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import BottomSheet, { BottomSheetScrollView, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { Feather } from "@expo/vector-icons";
import type { Hospital, HospitalCapability } from "@events/contracts";
import { distanceMeters } from "../navigation/geo";
import type { LatLng } from "../navigation/types";
import { useHospitalsStore } from "./hospitals-store";

/** Exported so the map can position the scale ruler above the open drawer. */
export const HOSPITALS_SHEET_SNAP_POINTS = ["46%", "88%"];
const SNAP_POINTS = HOSPITALS_SHEET_SNAP_POINTS;

/** Badge copy for capability codes — short, scannable pills. */
const CAPABILITY_LABELS: Record<HospitalCapability, string> = {
  er: "ER",
  trauma: "Trauma",
  icu: "ICU",
  ct: "CT",
  mri: "MRI",
  xray: "X-ray",
  cardiology: "Cardio",
  pediatric: "Pediatric",
  burn: "Burn",
  neurology: "Neuro",
  orthopedics: "Ortho",
  surgery: "Surgery",
};

/** Highlighted diagnostics come first on the pills row. */
const CAPABILITY_ORDER: HospitalCapability[] = [
  "er", "trauma", "icu", "ct", "mri", "xray",
  "cardiology", "surgery", "orthopedics", "neurology", "pediatric", "burn",
];

const SOFIA_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Sofia",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type OpenState = "open24" | "open" | "closed" | "unknown";

function openStateFor(hospital: Hospital, now = new Date()): OpenState {
  if (hospital.emergency24h) return "open24";
  if (hospital.hours && hospital.hours.length > 0) {
    const hm = SOFIA_TIME.format(now);
    const day = now.getDay();
    const openNow = hospital.hours.some((rule) => {
      if (!rule.days.includes(day)) return false;
      return rule.open <= rule.close
        ? hm >= rule.open && hm <= rule.close
        : hm >= rule.open || hm <= rule.close;
    });
    return openNow ? "open" : "closed";
  }
  return "unknown";
}

function formatKm(meters: number): string {
  return meters < 950 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(meters < 9500 ? 1 : 0)} km`;
}

/**
 * Bottom drawer with the hospitals directory: search, distance-sorted list,
 * capability badges, tap-to-call, in-app navigation and Google Maps handoff.
 */
export function HospitalsSheet({
  sheetRef,
  currentFix,
  onNavigate,
  onClose,
  onIndexChange,
  highlight,
}: {
  sheetRef: React.RefObject<BottomSheet | null>;
  currentFix: LatLng | null;
  /** Start in-app navigation to the hospital (closes the sheet first). */
  onNavigate: (hospital: Hospital) => void;
  onClose?: () => void;
  /** Live snap index (-1 = closed) — the map uses it to show pins / hide tracks. */
  onIndexChange?: (index: number) => void;
  /** A map pin was tapped: expand + scroll to + flash this hospital's card. */
  highlight?: { id: string; nonce: number } | null;
}) {
  const hospitals = useHospitalsStore((s) => s.hospitals);
  const loading = useHospitalsStore((s) => s.loading);
  const error = useHospitalsStore((s) => s.error);
  const load = useHospitalsStore((s) => s.load);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const scrollRef = useRef<React.ComponentRef<typeof BottomSheetScrollView> | null>(null);
  const cardY = useRef<Map<string, number>>(new Map());

  // React to a pin tap: expand the card, scroll it into view, flash briefly.
  useEffect(() => {
    if (!highlight) return;
    setExpandedId(highlight.id);
    setFlashId(highlight.id);
    const t1 = setTimeout(() => {
      const y = cardY.current.get(highlight.id);
      if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 60), animated: true });
    }, 120);
    const t2 = setTimeout(() => setFlashId(null), 1600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight?.nonce]);

  // Lazy-load the directory the first time the sheet opens.
  const handleSheetChange = useCallback(
    (index: number) => {
      onIndexChange?.(index);
      if (index >= 0) void load();
      if (index < 0) onClose?.();
    },
    [load, onClose, onIndexChange],
  );

  const visible = useMemo(() => {
    if (!hospitals) return [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? hospitals.filter(
          (h) =>
            h.name.toLowerCase().includes(q) ||
            h.nameBg?.toLowerCase().includes(q) ||
            h.city?.toLowerCase().includes(q),
        )
      : hospitals;
    if (!currentFix) return filtered;
    // Nearest first, but 24/7 ERs within 10 km always outrank everything —
    // in a field emergency those are the ones that matter.
    return [...filtered]
      .map((h) => ({ h, d: distanceMeters(currentFix, { lat: h.lat, lng: h.lng }) }))
      .map((x) => ({ ...x, priority: x.h.emergency24h && x.d <= 10_000 ? 0 : 1 }))
      .sort((a, b) => a.priority - b.priority || a.d - b.d)
      .map(({ h }) => h);
  }, [hospitals, search, currentFix]);

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={SNAP_POINTS}
      enableDynamicSizing={false}
      // Deliberately NOT closable by dragging down — a stray swipe while
      // scrolling the list must not dismiss the directory. Close via the X.
      enablePanDownToClose={false}
      onChange={handleSheetChange}
      backgroundStyle={styles.sheetBg}
      handleStyle={styles.sheetHandleContainer}
      handleIndicatorStyle={styles.sheetHandle}
    >
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View style={styles.headerIconWrap}>
            <Feather name="plus-square" size={16} color="#f87171" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Hospitals</Text>
            <Text style={styles.headerSubtitle}>
              {currentFix ? "Nearest first · tap a card for actions" : "Waiting for GPS — alphabetical"}
            </Text>
          </View>
          <Pressable style={styles.closeBtn} onPress={() => sheetRef.current?.close()} hitSlop={8}>
            <Feather name="x" size={18} color="#cbd5e1" />
          </Pressable>
        </View>
        <BottomSheetTextInput
          style={styles.searchInput}
          placeholder="Search by name or city…"
          placeholderTextColor="#475569"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <BottomSheetScrollView ref={scrollRef} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator color="#34d399" />
            <Text style={styles.stateText}>Loading hospitals…</Text>
          </View>
        ) : error ? (
          <View style={styles.stateWrap}>
            <Text style={styles.stateText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.stateWrap}>
            <Text style={styles.stateText}>{search ? "No hospitals match your search." : "No hospitals in the directory yet."}</Text>
          </View>
        ) : (
          visible.map((h) => (
            <View key={h.id} onLayout={(e) => cardY.current.set(h.id, e.nativeEvent.layout.y)}>
              <HospitalCard
                hospital={h}
                distance={currentFix ? distanceMeters(currentFix, { lat: h.lat, lng: h.lng }) : null}
                expanded={expandedId === h.id}
                flash={flashId === h.id}
                onToggle={() => setExpandedId((cur) => (cur === h.id ? null : h.id))}
                onNavigate={() => onNavigate(h)}
              />
            </View>
          ))
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

function HospitalCard({
  hospital: h,
  distance,
  expanded,
  flash,
  onToggle,
  onNavigate,
}: {
  hospital: Hospital;
  distance: number | null;
  expanded: boolean;
  flash?: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const open = openStateFor(h);
  const caps = CAPABILITY_ORDER.filter((c) => h.capabilities.includes(c));

  return (
    <Pressable style={[styles.card, expanded && styles.cardExpanded, flash && styles.cardFlash]} onPress={onToggle}>
      <View style={styles.cardTopRow}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle} numberOfLines={expanded ? undefined : 2}>
            {h.name}
          </Text>
          {h.nameBg && h.nameBg !== h.name ? (
            <Text style={styles.cardSubtitle} numberOfLines={expanded ? undefined : 1}>
              {h.nameBg}
            </Text>
          ) : null}
        </View>
        {distance !== null ? (
          <View style={styles.distancePill}>
            <Feather name="navigation" size={10} color="#7dd3fc" />
            <Text style={styles.distanceText}>{formatKm(distance)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        <OpenBadge state={open} hoursText={h.hoursText} />
        {h.city ? <Text style={styles.cityText}>· {h.city}</Text> : null}
        {h.address ? (
          <Text style={styles.cityText} numberOfLines={1}>
            · {h.address}
          </Text>
        ) : null}
      </View>

      {caps.length > 0 ? (
        <View style={styles.capRow}>
          {caps.map((c) => (
            <View key={c} style={[styles.capPill, c === "er" && styles.capPillEr]}>
              <Text style={[styles.capText, c === "er" && styles.capTextEr]}>{CAPABILITY_LABELS[c]}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {expanded ? (
        <View style={styles.actionsWrap}>
          {h.phones.map((phone) => (
            <Pressable
              key={phone}
              style={styles.phoneRow}
              onPress={() => void Linking.openURL(`tel:${phone.replace(/\s+/g, "")}`)}
            >
              <View style={styles.phoneIconWrap}>
                <Feather name="phone" size={13} color="#34d399" />
              </View>
              <Text style={styles.phoneText}>{phone}</Text>
              <Text style={styles.phoneHint}>tap to call</Text>
            </Pressable>
          ))}
          {h.notes ? <Text style={styles.notesText}>{h.notes}</Text> : null}
          <View style={styles.actionButtonsRow}>
            <Pressable style={styles.navigateBtn} onPress={onNavigate}>
              <Feather name="navigation" size={14} color="#04121f" />
              <Text style={styles.navigateBtnText}>Navigate</Text>
            </Pressable>
            <Pressable
              style={styles.gmapsBtn}
              onPress={() =>
                void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`)
              }
            >
              <Feather name="external-link" size={14} color="#9fb3cc" />
              <Text style={styles.gmapsBtnText}>Google Maps</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

function OpenBadge({ state, hoursText }: { state: OpenState; hoursText?: string }) {
  const config =
    state === "open24"
      ? { color: "#34d399", label: "24/7" }
      : state === "open"
        ? { color: "#34d399", label: "Open now" }
        : state === "closed"
          ? { color: "#f87171", label: "Closed now" }
          : { color: "#64748b", label: hoursText ? hoursText.slice(0, 24) : "Hours unknown" };
  return (
    <View style={styles.openBadge}>
      <View style={[styles.openDot, { backgroundColor: config.color }]} />
      <Text style={[styles.openText, { color: config.color }]} numberOfLines={1}>
        {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheetBg: { backgroundColor: "#131a22", borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sheetHandle: { backgroundColor: "rgba(148,163,184,0.5)", width: 72, height: 6.5, borderRadius: 999 },
  sheetHandleContainer: { paddingTop: 12, paddingBottom: 12 },
  header: { paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(248,113,113,0.12)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.3)",
  },
  headerTitle: { color: "#f1f5f9", fontSize: 16, fontWeight: "900", letterSpacing: 0.2 },
  headerSubtitle: { color: "#64748b", fontSize: 11.5, fontWeight: "600", marginTop: 1 },
  searchInput: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.15)",
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 9,
    color: "#f1f5f9",
    fontSize: 14,
  },
  listContent: { paddingHorizontal: 14, paddingBottom: 40, gap: 8 },
  stateWrap: { alignItems: "center", paddingVertical: 36, gap: 10 },
  stateText: { color: "#64748b", fontSize: 13, fontWeight: "600", textAlign: "center", paddingHorizontal: 24 },
  retryBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(52,211,153,0.12)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.35)",
  },
  retryText: { color: "#34d399", fontWeight: "800", fontSize: 13 },
  card: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.1)",
  },
  cardExpanded: { borderColor: "rgba(52,211,153,0.35)", backgroundColor: "rgba(52,211,153,0.05)" },
  cardFlash: { borderColor: "#7dd3fc", backgroundColor: "rgba(125,211,252,0.1)" },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  cardTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardTitleWrap: { flex: 1 },
  cardTitle: { color: "#f1f5f9", fontSize: 14, fontWeight: "800", lineHeight: 18 },
  cardSubtitle: { color: "#7d8ea4", fontSize: 12, marginTop: 1 },
  distancePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(125,211,252,0.1)",
    borderWidth: 1,
    borderColor: "rgba(125,211,252,0.25)",
  },
  distanceText: { color: "#7dd3fc", fontSize: 11.5, fontWeight: "800" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, flexWrap: "wrap" },
  openBadge: { flexDirection: "row", alignItems: "center", gap: 5 },
  openDot: { width: 6, height: 6, borderRadius: 3 },
  openText: { fontSize: 11, fontWeight: "800" },
  cityText: { color: "#64748b", fontSize: 11, fontWeight: "600", flexShrink: 1 },
  capRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 },
  capPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "rgba(148,163,184,0.1)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  capPillEr: { backgroundColor: "rgba(248,113,113,0.12)", borderColor: "rgba(248,113,113,0.35)" },
  capText: { color: "#9fb3cc", fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  capTextEr: { color: "#f87171" },
  actionsWrap: { marginTop: 10, gap: 7 },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(52,211,153,0.06)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.18)",
  },
  phoneIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(52,211,153,0.12)",
  },
  phoneText: { color: "#e2e8f0", fontSize: 13.5, fontWeight: "800", flex: 1 },
  phoneHint: { color: "#475569", fontSize: 10.5, fontWeight: "700" },
  notesText: { color: "#7d8ea4", fontSize: 12, lineHeight: 17 },
  actionButtonsRow: { flexDirection: "row", gap: 8, marginTop: 2 },
  navigateBtn: {
    flex: 1.2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: "#34d399",
  },
  navigateBtnText: { color: "#04121f", fontSize: 13.5, fontWeight: "900" },
  gmapsBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
  },
  gmapsBtnText: { color: "#9fb3cc", fontSize: 13, fontWeight: "800" },
});
