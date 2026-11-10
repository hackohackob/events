import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { medicPresence } from "@events/contracts";
import { apiFetch } from "../ui/api-client";
import { useForegroundInterval } from "../ui/useForegroundInterval";
import { useSessionStore } from "../security/session-store";
import { freshnessLabel } from "../map/freshness";
import { debugLog } from "./debug-log";

/**
 * One medic's phone, as the server sees it. Mirrors the backend's
 * `MedicDiagSummary` (location-diagnostics.service.ts) — kept local because the
 * shape is served to coordinators only and is not part of the shared contract.
 */
export interface TeamPhone {
  medicId: string;
  name: string | null;
  lastFixAt: string | null;
  lastAccuracy: number | null;
  battery: number | null;
  status: string | null;
  platform: string | null;
  appVersion: string | null;
  device: string | null;
  lastDiagAt: string | null;
  errors24h: number;
  lastErrorAt: string | null;
  lastErrorHint: string | null;
  /** Standing problems with this phone, in plain language. */
  problems: string[];
  // Absent from a backend older than this screen.
  lastSeenAt?: string | null;
  hasPush?: boolean;
  oldBuild?: boolean;
}

const REFRESH_MS = 30_000;
/** A phone not heard from in a day belongs to someone who has gone home. */
const ON_DUTY_MS = 24 * 60 * 60_000;

function ageOf(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

/** When the phone was last heard from — a heartbeat counts, not only a fix. */
function heardAt(phone: TeamPhone): string | null {
  return phone.lastSeenAt ?? phone.lastFixAt ?? phone.lastDiagAt;
}

function needsAttention(phone: TeamPhone): boolean {
  return phone.problems.length > 0;
}

/**
 * The team's phones, for coordinators: who is set up wrong, who has gone
 * quiet, who is on an old build. Polls while the screen is open and in the
 * foreground; the caller decides whether to enable it at all.
 */
export function useTeamPhones(enabled: boolean) {
  const eventId = useSessionStore((s) => s.eventId);
  const [phones, setPhones] = useState<TeamPhone[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !eventId) return;
    try {
      const rows = await apiFetch<TeamPhone[]>(`/events/${eventId}/location-diagnostics/summary`);
      setPhones(Array.isArray(rows) ? rows : []);
      setError(null);
      setLoadedAt(Date.now());
    } catch (err) {
      debugLog("api", "warn", "team phones fetch failed", String(err));
      setError("Couldn’t load the team’s phones — check the connection");
    }
  }, [enabled, eventId]);

  useForegroundInterval(() => void load(), enabled ? REFRESH_MS : null);

  const onDuty = useMemo(
    () =>
      (phones ?? []).filter((p) => {
        const age = ageOf(heardAt(p));
        return age != null && age < ON_DUTY_MS;
      }),
    [phones],
  );
  const attention = useMemo(() => onDuty.filter(needsAttention).length, [onDuty]);

  return { phones: onDuty, total: phones?.length ?? 0, attention, loading: phones == null && !error, error, loadedAt, reload: load };
}

export type TeamPhonesState = ReturnType<typeof useTeamPhones>;

const TONE = {
  bad: "#ff6b6b",
  warn: "#f5c518",
  ok: "#22ff88",
  off: "#7c8a9c",
};

function Chip({ icon, label, tone }: { icon: React.ComponentProps<typeof Feather>["name"]; label: string; tone?: keyof typeof TONE }) {
  const color = tone ? TONE[tone] : "#9fb3c8";
  return (
    <View style={styles.chip}>
      <Feather name={icon} size={11} color={color} />
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function PhoneCard({ phone }: { phone: TeamPhone }) {
  const heard = heardAt(phone);
  const presence = medicPresence(heard);
  const flagged = needsAttention(phone);
  const dot = flagged ? TONE.bad : presence === "live" ? TONE.ok : presence === "late" ? TONE.warn : TONE.off;
  const fixAge = ageOf(phone.lastFixAt);
  const platform = phone.platform === "ios" ? "iOS" : phone.platform === "android" ? "Android" : null;

  return (
    <View style={[styles.card, flagged && styles.cardFlagged]}>
      <View style={styles.cardHead}>
        <View style={[styles.dot, { backgroundColor: dot }]} />
        <Text style={styles.name} numberOfLines={1}>
          {phone.name || "Unknown medic"}
        </Text>
        <Text style={[styles.heard, { color: presence === "live" ? "#9fb3c8" : presence === "late" ? TONE.warn : TONE.off }]}>
          {heard ? freshnessLabel(ageOf(heard)) : "never"}
        </Text>
      </View>

      <View style={styles.chips}>
        <Chip
          icon="smartphone"
          label={phone.appVersion ? `${platform ?? "?"} · v${phone.appVersion}` : "unknown build"}
          tone={phone.appVersion ? undefined : "warn"}
        />
        {phone.lastAccuracy != null ? (
          <Chip icon="crosshair" label={`±${Math.round(phone.lastAccuracy)} m`} tone={phone.lastAccuracy > 100 ? "warn" : undefined} />
        ) : null}
        {phone.battery != null ? (
          <Chip
            icon="battery"
            label={`${Math.round(phone.battery * 100)}%`}
            tone={phone.battery <= 0.15 ? "bad" : phone.battery <= 0.3 ? "warn" : undefined}
          />
        ) : null}
        {phone.hasPush === false ? <Chip icon="bell-off" label="no alarms" tone="bad" /> : null}
        {fixAge != null && heard !== phone.lastFixAt ? <Chip icon="map-pin" label={`fix ${freshnessLabel(fixAge)}`} /> : null}
      </View>

      {phone.problems.map((problem) => (
        <View key={problem} style={styles.problem}>
          <Feather name="alert-triangle" size={12} color={TONE.bad} style={styles.problemIcon} />
          <Text style={styles.problemText}>{problem}</Text>
        </View>
      ))}

      {phone.errors24h > 0 && phone.lastErrorHint ? (
        <View style={styles.problem}>
          <Feather name="info" size={12} color={TONE.warn} style={styles.problemIcon} />
          <Text style={[styles.problemText, { color: "#e7d9a8" }]}>
            {phone.lastErrorHint}
            {phone.errors24h > 1 ? `  (${phone.errors24h}× in 24 h)` : ""}
          </Text>
        </View>
      ) : null}

      {!flagged && phone.errors24h === 0 ? <Text style={styles.fine}>No known problems with this phone</Text> : null}
    </View>
  );
}

/**
 * The Team tab of Location diagnostics. Read-only: it says which phone needs a
 * hand and why, in the words the server already uses on the dashboard's
 * Location page — the fix itself happens on that medic's phone.
 */
export function TeamPhones({ state }: { state: TeamPhonesState }) {
  const { phones, total, attention, loading, error, loadedAt, reload } = state;
  const [refreshing, setRefreshing] = useState(false);

  const sorted = useMemo(
    () =>
      [...phones].sort((a, b) => {
        const byProblems = b.problems.length - a.problems.length;
        if (byProblems !== 0) return byProblems;
        // Then the quietest first: silence is the next thing worth a look.
        return (ageOf(heardAt(b)) ?? 0) - (ageOf(heardAt(a)) ?? 0);
      }),
    [phones],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const offDuty = total - phones.length;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22ff88" />}
    >
      <View style={[styles.summary, attention > 0 ? styles.summaryBad : phones.length > 0 ? styles.summaryOk : null]}>
        {loading ? (
          <ActivityIndicator color="#22ff88" />
        ) : (
          <>
            <Text style={[styles.summaryTitle, { color: attention > 0 ? TONE.bad : phones.length > 0 ? TONE.ok : "#cdd9e8" }]}>
              {phones.length === 0
                ? "No phones on this event yet"
                : attention > 0
                  ? `${attention} of ${phones.length} phone${phones.length === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} attention`
                  : `All ${phones.length} phone${phones.length === 1 ? "" : "s"} look fine`}
            </Text>
            <Text style={styles.summarySub}>
              {error ?? (loadedAt ? `Updated ${freshnessLabel(Date.now() - loadedAt)} · pull to refresh` : "")}
            </Text>
          </>
        )}
      </View>

      {sorted.map((phone) => (
        <PhoneCard key={phone.medicId} phone={phone} />
      ))}

      {offDuty > 0 ? (
        <Text style={styles.footnote}>
          {offDuty} more not heard from in the last 24 h — left out.
        </Text>
      ) : null}
      <Text style={styles.footnote}>
        A problem is fixed on that medic’s phone: open the app there, then Location diagnostics.
      </Text>
    </ScrollView>
  );
}

/** "This phone" / "Team" — shown above the diagnostics for coordinators only. */
export function TeamTabBar({
  view,
  onChange,
  attention,
}: {
  view: "phone" | "team";
  onChange: (view: "phone" | "team") => void;
  attention: number;
}) {
  return (
    <View style={styles.tabs}>
      {(["phone", "team"] as const).map((key) => {
        const active = view === key;
        return (
          <Pressable key={key} style={[styles.tab, active && styles.tabActive]} onPress={() => onChange(key)}>
            <Feather name={key === "phone" ? "smartphone" : "users"} size={14} color={active ? "#22ff88" : "#7c8a9c"} />
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{key === "phone" ? "This phone" : "Team"}</Text>
            {key === "team" && attention > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{attention}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  tabs: {
    flexDirection: "row",
    gap: 6,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 4,
    borderRadius: 14,
    backgroundColor: "#0b1729",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 9,
    borderRadius: 10,
  },
  tabActive: { backgroundColor: "rgba(34,255,136,0.1)", borderWidth: 1, borderColor: "rgba(34,255,136,0.35)" },
  tabText: { color: "#7c8a9c", fontSize: 13, fontWeight: "800" },
  tabTextActive: { color: "#eff6ff" },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ff6b6b",
  },
  badgeText: { color: "#2b0707", fontSize: 11, fontWeight: "900" },
  summary: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    minHeight: 68,
    justifyContent: "center",
    backgroundColor: "#0b1729",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
  },
  summaryBad: { borderColor: "rgba(255,107,107,0.45)", backgroundColor: "rgba(255,107,107,0.07)" },
  summaryOk: { borderColor: "rgba(34,255,136,0.3)", backgroundColor: "rgba(34,255,136,0.05)" },
  summaryTitle: { fontSize: 16, fontWeight: "900" },
  summarySub: { color: "#7c8a9c", fontSize: 12, fontWeight: "600", marginTop: 4 },
  card: {
    backgroundColor: "#0b1729",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
  },
  cardFlagged: { borderColor: "rgba(255,107,107,0.4)" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  name: { flex: 1, color: "#eff6ff", fontSize: 15, fontWeight: "800" },
  heard: { fontSize: 12, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    maxWidth: "100%",
  },
  chipText: { fontSize: 11, fontWeight: "700" },
  problem: { flexDirection: "row", alignItems: "flex-start", gap: 7, marginTop: 9 },
  problemIcon: { marginTop: 2 },
  problemText: { flex: 1, color: "#ffc9c9", fontSize: 13, fontWeight: "600", lineHeight: 18 },
  fine: { color: "#5f9c7b", fontSize: 12, fontWeight: "600", marginTop: 9 },
  footnote: { color: "#5f7da0", fontSize: 12, lineHeight: 17, marginTop: 6, paddingHorizontal: 2 },
});
