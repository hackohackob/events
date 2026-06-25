import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { joinEvent } from "./join-event";
import { useSessionStore } from "../security/session-store";
import { apiFetch } from "../ui/api-client";

interface MedicEntry {
  id: string;
  name: string;
  unit?: string;
  vehicle?: string;
}

interface ActiveEvent {
  id: string;
  title: string;
  status: string;
}

/** Minimum characters before an external guest can join. */
const MIN_EXTERNAL_NAME = 3;

export function JoinScreen() {
  // Event selection
  const [events, setEvents] = useState<ActiveEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<ActiveEvent | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);

  // Medic roster + external guest
  const [medics, setMedics] = useState<MedicEntry[]>([]);
  const [loadingMedics, setLoadingMedics] = useState(false);
  const [selectedMedic, setSelectedMedic] = useState<MedicEntry | null>(null);
  const [external, setExternal] = useState(false);
  const [externalName, setExternalName] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showEnv, setShowEnv] = useState(false);

  const setSession = useSessionStore((state) => state.setSession);
  const setEventTitle = useSessionStore((state) => state.setEventTitle);

  const cardEntrance = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(cardEntrance, {
      toValue: 1, duration: 760,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 2100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 2100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);

  // Load the list of active events on mount.
  useEffect(() => {
    let alive = true;
    setLoadingEvents(true);
    apiFetch<ActiveEvent[]>("/events")
      .then((list) => {
        if (!alive) return;
        const active = list.filter((e) => e.status === "active");
        setEvents(active);
        // Single active event → preselect it (saves a tap).
        if (active.length === 1) chooseEvent(active[0]);
      })
      .catch(() => alive && setError("Could not load events. Check your connection."))
      .finally(() => alive && setLoadingEvents(false));
    return () => {
      alive = false;
    };
  }, []);

  function chooseEvent(ev: ActiveEvent) {
    setSelectedEvent(ev);
    setEventsOpen(false);
    setSelectedMedic(null);
    setExternal(false);
    setError(null);
    void fetchMedics(ev.id);
  }

  async function fetchMedics(eventId: string) {
    setLoadingMedics(true);
    setError(null);
    try {
      const data = await apiFetch<MedicEntry[]>(`/events/${eventId}/medics`);
      setMedics(data);
    } catch {
      setError("Could not load the medic roster for this event.");
    } finally {
      setLoadingMedics(false);
    }
  }

  const externalReady = externalName.trim().length >= MIN_EXTERNAL_NAME;
  const canJoin = !!selectedEvent && !submitting && (external ? externalReady : !!selectedMedic);

  const onJoin = async () => {
    if (!canJoin || !selectedEvent) return;
    setError(null);
    setSubmitting(true);
    try {
      const payload = external
        ? { joinCode: selectedEvent.id, name: externalName.trim(), role: "external" as const }
        : { joinCode: selectedEvent.id, medicId: selectedMedic!.id, role: "medic" as const };

      const response = await joinEvent(payload as any);
      setSession({
        token: response.token,
        eventId: response.session.eventId,
        userId: response.session.userId,
        role: response.session.role,
      });
      apiFetch<{ title: string }>(`/events/${response.session.eventId}`)
        .then((event) => setEventTitle(event.title))
        .catch(() => {/* non-critical */});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to join event");
    } finally {
      setSubmitting(false);
    }
  };

  const loadedEnv = {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "",
    wsUrl: process.env.EXPO_PUBLIC_WS_URL ?? "",
  };

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.container}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[styles.glow, styles.glowTop, {
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }],
          }]}
        />
        <Animated.View
          style={[styles.glow, styles.glowBottom, {
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1.05, 0.88] }) }],
          }]}
        />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[styles.card, {
            opacity: cardEntrance,
            transform: [{ translateY: cardEntrance.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }],
          }]}
        >
          <View style={styles.logoRow}>
            <Image source={require("../../assets/logo.png")} style={styles.logoImage} resizeMode="contain" />
            <Text style={styles.heroAccent}>Ready when{"\n"}it matters.</Text>
          </View>
          <Text style={styles.subtitle}>
            Real-time coordination for medical teams during races and outdoor events.
          </Text>

          {/* Event picker */}
          <Text style={styles.fieldLabel}>Event</Text>
          <Pressable style={styles.select} onPress={() => setEventsOpen((o) => !o)} disabled={loadingEvents}>
            <Text style={styles.selectIcon}>#</Text>
            <Text style={[styles.selectValue, !selectedEvent && styles.selectPlaceholder]} numberOfLines={1}>
              {loadingEvents ? "Loading events…" : selectedEvent ? selectedEvent.title : "Select an active event"}
            </Text>
            {loadingEvents ? <ActivityIndicator color="#65d978" /> : <Text style={styles.chevron}>{eventsOpen ? "▴" : "▾"}</Text>}
          </Pressable>

          {eventsOpen && !loadingEvents && (
            <View style={styles.dropdown}>
              {events.length === 0 ? (
                <Text style={styles.dropdownEmpty}>No active events right now.</Text>
              ) : (
                events.map((ev) => (
                  <Pressable
                    key={ev.id}
                    onPress={() => chooseEvent(ev)}
                    style={[styles.dropdownRow, selectedEvent?.id === ev.id && styles.dropdownRowActive]}
                  >
                    <Text style={[styles.dropdownText, selectedEvent?.id === ev.id && { color: "#fff" }]} numberOfLines={1}>
                      {ev.title}
                    </Text>
                    {selectedEvent?.id === ev.id && <Text style={styles.checkmark}>✓</Text>}
                  </Pressable>
                ))
              )}
            </View>
          )}

          {/* Medic roster (after an event is chosen) */}
          {selectedEvent && (
            <View style={styles.rosterShell}>
              <Text style={styles.rosterLabel}>Who are you?</Text>
              {loadingMedics ? (
                <View style={styles.rosterLoading}>
                  <ActivityIndicator color="#65d978" />
                  <Text style={styles.rosterLoadingText}>Loading roster…</Text>
                </View>
              ) : (
                <>
                  {medics.map((m) => {
                    const sel = !external && selectedMedic?.id === m.id;
                    return (
                      <Pressable
                        key={m.id}
                        onPress={() => { setSelectedMedic(m); setExternal(false); }}
                        style={[styles.medicRow, sel && styles.medicRowSelected]}
                      >
                        <View style={[styles.medicAvatar, sel && styles.medicAvatarSelected]}>
                          <Text style={[styles.medicAvatarText, sel && { color: "#0f2513" }]}>
                            {m.name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("")}
                          </Text>
                        </View>
                        <View style={styles.medicInfo}>
                          <Text style={[styles.medicName, sel && { color: "#fff" }]}>{m.name}</Text>
                          {(m.unit || m.vehicle) && (
                            <Text style={styles.medicSub}>{[m.unit, m.vehicle].filter(Boolean).join(" · ")}</Text>
                          )}
                        </View>
                        {sel && <Text style={styles.checkmark}>✓</Text>}
                      </Pressable>
                    );
                  })}

                  {/* External / organizer entry — always last */}
                  <Pressable
                    onPress={() => { setExternal(true); setSelectedMedic(null); }}
                    style={[styles.medicRow, styles.externalRow, external && styles.medicRowSelected]}
                  >
                    <View style={[styles.medicAvatar, styles.externalAvatar, external && styles.medicAvatarSelected]}>
                      <Text style={[styles.medicAvatarText, external && { color: "#0f2513" }]}>+</Text>
                    </View>
                    <View style={styles.medicInfo}>
                      <Text style={[styles.medicName, external && { color: "#fff" }]}>External</Text>
                      <Text style={styles.medicSub}>Organizer or guest — enter your name</Text>
                    </View>
                    {external && <Text style={styles.checkmark}>✓</Text>}
                  </Pressable>

                  {external && (
                    <View style={styles.externalInputShell}>
                      <Text style={styles.inputIcon}>ID</Text>
                      <TextInput
                        value={externalName}
                        onChangeText={setExternalName}
                        placeholder="Your full name"
                        placeholderTextColor="#7f95aa"
                        style={styles.input}
                        autoFocus
                      />
                    </View>
                  )}
                </>
              )}
            </View>
          )}

          <Pressable
            onPress={onJoin}
            style={[styles.cta, !canJoin && styles.ctaDisabled]}
            disabled={!canJoin}
          >
            <Text style={styles.ctaText}>{submitting ? "Connecting…" : "Join Event"}</Text>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={styles.envToggle} onPress={() => setShowEnv((v) => !v)}>
            <Text style={styles.envToggleText}>{showEnv ? "Hide diagnostics" : "Show diagnostics"}</Text>
          </Pressable>

          {showEnv && (
            <View style={styles.envCard}>
              <Text style={styles.envTitle}>Runtime configuration</Text>
              <Text style={styles.envLine}>API: {loadedEnv.apiUrl || "(empty)"}</Text>
              <Text style={styles.envLine}>WS: {loadedEnv.wsUrl || "(empty)"}</Text>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#030d1f" },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 24 },
  glow: { position: "absolute", borderRadius: 999 },
  glowTop: { width: 280, height: 280, top: -80, right: -70, backgroundColor: "rgba(66,162,92,0.26)" },
  glowBottom: { width: 320, height: 320, bottom: -120, left: -100, backgroundColor: "rgba(52,116,194,0.28)" },
  card: {
    borderRadius: 28, borderWidth: 1,
    borderColor: "rgba(140,160,186,0.24)",
    backgroundColor: "rgba(5,17,35,0.82)",
    padding: 20,
    shadowColor: "#020914", shadowOpacity: 0.32, shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 }, elevation: 15,
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 4, marginBottom: 4 },
  logoImage: { width: 64, height: 64 },
  heroAccent: { color: "#69dc7d", fontSize: 28, fontWeight: "900", lineHeight: 32, flex: 1 },
  subtitle: { color: "#b7c7d8", fontSize: 15, lineHeight: 21, marginTop: 10, marginBottom: 16 },

  fieldLabel: { color: "#65d978", fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 },
  select: {
    borderRadius: 16, borderWidth: 1, borderColor: "rgba(143,168,199,0.24)",
    backgroundColor: "rgba(6,22,42,0.95)", paddingHorizontal: 14,
    flexDirection: "row", alignItems: "center", minHeight: 56, gap: 8,
  },
  selectIcon: { width: 24, color: "#65d978", fontSize: 17, fontWeight: "700" },
  selectValue: { flex: 1, color: "#ecf5ff", fontSize: 17, fontWeight: "600" },
  selectPlaceholder: { color: "#7f95aa" },
  chevron: { color: "#7f95aa", fontSize: 16, fontWeight: "800" },

  dropdown: {
    marginTop: 8, borderRadius: 16, borderWidth: 1, borderColor: "rgba(143,168,199,0.2)",
    backgroundColor: "rgba(6,22,42,0.97)", overflow: "hidden",
  },
  dropdownEmpty: { color: "#7f95aa", fontSize: 14, padding: 14, textAlign: "center" },
  dropdownRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(143,168,199,0.12)",
  },
  dropdownRowActive: { backgroundColor: "rgba(105,214,114,0.1)" },
  dropdownText: { flex: 1, color: "#c0cfe0", fontSize: 15, fontWeight: "700" },

  rosterShell: {
    borderRadius: 16, borderWidth: 1, borderColor: "rgba(143,168,199,0.18)",
    backgroundColor: "rgba(6,22,42,0.9)", padding: 12, marginTop: 14, marginBottom: 14,
  },
  rosterLabel: { color: "#65d978", fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 },
  rosterLoading: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  rosterLoadingText: { color: "#7f95aa", fontSize: 14 },

  medicRow: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 10,
    borderRadius: 12, marginBottom: 8,
    borderWidth: 1, borderColor: "transparent",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  medicRowSelected: { backgroundColor: "rgba(105,214,114,0.1)", borderColor: "rgba(105,214,114,0.35)" },
  externalRow: { borderStyle: "dashed", borderColor: "rgba(143,168,199,0.35)" },
  medicAvatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(105,214,114,0.12)",
    borderWidth: 1.5, borderColor: "rgba(105,214,114,0.3)",
  },
  externalAvatar: { backgroundColor: "rgba(143,168,199,0.12)", borderColor: "rgba(143,168,199,0.35)" },
  medicAvatarSelected: { backgroundColor: "#69d672", borderColor: "#69d672" },
  medicAvatarText: { color: "#69d672", fontSize: 15, fontWeight: "800" },
  medicInfo: { flex: 1 },
  medicName: { color: "#c0cfe0", fontSize: 15, fontWeight: "700" },
  medicSub: { color: "#556070", fontSize: 12, marginTop: 1 },
  checkmark: { color: "#69d672", fontSize: 20, fontWeight: "900" },

  externalInputShell: {
    borderRadius: 14, borderWidth: 1, borderColor: "rgba(105,214,114,0.4)",
    backgroundColor: "rgba(6,22,42,0.95)", paddingHorizontal: 14,
    flexDirection: "row", alignItems: "center", minHeight: 54, marginTop: 2,
  },
  inputIcon: { width: 24, color: "#65d978", fontSize: 15, fontWeight: "700" },
  input: { flex: 1, color: "#ecf5ff", fontSize: 17, fontWeight: "600", paddingVertical: 12, marginLeft: 8 },

  cta: {
    marginTop: 8, borderRadius: 16, minHeight: 56,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#69d672",
    shadowColor: "#60dd77", shadowOpacity: 0.38, shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: "#0f2513", fontSize: 21, fontWeight: "900", letterSpacing: 0.3 },
  error: { color: "#fecaca", fontWeight: "700", marginTop: 10, fontSize: 14 },
  envToggle: { marginTop: 12, alignSelf: "center", paddingHorizontal: 10, paddingVertical: 6 },
  envToggleText: { color: "#91a5bc", fontSize: 13, fontWeight: "600" },
  envCard: { marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: "rgba(118,195,130,0.35)", backgroundColor: "rgba(5,20,35,0.95)", padding: 10 },
  envTitle: { color: "#6fda81", fontSize: 11, letterSpacing: 0.6, fontWeight: "800", marginBottom: 6, textTransform: "uppercase" },
  envLine: { color: "#d2d9e2", fontSize: 11, marginBottom: 2 },
});
