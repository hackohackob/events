import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
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

type JoinMode = "runner" | "medic";

interface MedicEntry {
  id: string;
  name: string;
  unit?: string;
  vehicle?: string;
}

function maskValue(value: string, visibleStart = 10, visibleEnd = 4): string {
  if (!value) return "(empty)";
  if (value.length <= visibleStart + visibleEnd) return value;
  return `${value.slice(0, visibleStart)}...${value.slice(-visibleEnd)}`;
}

export function JoinScreen() {
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState<JoinMode>("runner");

  // Runner fields
  const [name, setName] = useState("");
  const [bibNumber, setBibNumber] = useState("");
  const [phone, setPhone] = useState("");

  // Medic fields
  const [medics, setMedics] = useState<MedicEntry[]>([]);
  const [loadingMedics, setLoadingMedics] = useState(false);
  const [selectedMedic, setSelectedMedic] = useState<MedicEntry | null>(null);

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

  async function fetchMedics() {
    if (!joinCode.trim()) return;
    setLoadingMedics(true);
    setError(null);
    try {
      const data = await apiFetch<MedicEntry[]>(`/events/${joinCode.trim()}/medics`);
      setMedics(data);
    } catch {
      setError("Could not load medic list. Check the event code.");
    } finally {
      setLoadingMedics(false);
    }
  }

  useEffect(() => {
    if (mode === "medic" && joinCode.trim()) {
      void fetchMedics();
    }
  }, [mode]);


  const onJoin = async () => {
    setError(null);

    if (mode === "runner" && !name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (mode === "medic" && !selectedMedic) {
      setError("Please select your name from the list.");
      return;
    }

    setSubmitting(true);
    try {
      const payload =
        mode === "runner"
          ? { joinCode: joinCode.trim(), name, bibNumber, phone, role: "runner" as const }
          : { joinCode: joinCode.trim(), medicId: selectedMedic!.id, role: "medic" as const };

      const response = await joinEvent(payload as any);
      setSession({
        token: response.token,
        eventId: response.session.eventId,
        role: response.session.role,
      });
      // Fetch event title in background (non-blocking)
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
      {/* Background glows */}
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
            <Image
              source={require("../../assets/logo.png")}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Text style={styles.heroAccent}>Ready when{"\n"}it matters.</Text>
          </View>
          <Text style={styles.subtitle}>
            Real-time coordination for medical teams during races and outdoor events.
          </Text>

          {/* Event code */}
          <View style={styles.inputShell}>
            <Text style={styles.inputIcon}>#</Text>
            <TextInput
              value={joinCode}
              onChangeText={setJoinCode}
              placeholder="Event code"
              placeholderTextColor="#7f95aa"
              style={styles.input}
              autoCapitalize="none"
            />
          </View>

          {/* Mode selector */}
          <View style={styles.modeRow}>
            {(["runner", "medic"] as JoinMode[]).map((m) => (
              <Pressable
                key={m}
                onPress={() => { setMode(m); setError(null); setSelectedMedic(null); }}
                style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
              >
                <Text style={[styles.modeBtnText, mode === m && styles.modeBtnTextActive]}>
                  {m === "runner" ? "Participant" : "Medic"}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Runner fields */}
          {mode === "runner" && (
            <>
              <View style={styles.inputShell}>
                <Text style={styles.inputIcon}>ID</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Full name"
                  placeholderTextColor="#7f95aa"
                  style={styles.input}
                />
              </View>
              <View style={styles.inputShell}>
                <Text style={styles.inputIcon}>BN</Text>
                <TextInput
                  value={bibNumber}
                  onChangeText={setBibNumber}
                  placeholder="Bib number (optional)"
                  placeholderTextColor="#7f95aa"
                  style={styles.input}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.inputShell}>
                <Text style={styles.inputIcon}>☎</Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="Phone (optional)"
                  placeholderTextColor="#7f95aa"
                  style={styles.input}
                  keyboardType="phone-pad"
                />
              </View>
            </>
          )}

          {/* Medic roster */}
          {mode === "medic" && (
            <View style={styles.rosterShell}>
              <Text style={styles.rosterLabel}>Select your name</Text>
              {loadingMedics ? (
                <View style={styles.rosterLoading}>
                  <ActivityIndicator color="#65d978" />
                  <Text style={styles.rosterLoadingText}>Loading roster…</Text>
                </View>
              ) : medics.length === 0 ? (
                <View style={styles.rosterEmpty}>
                  <Text style={styles.rosterEmptyText}>No medics found for this event.</Text>
                  <Pressable onPress={fetchMedics} style={styles.retryBtn}>
                    <Text style={styles.retryBtnText}>Retry</Text>
                  </Pressable>
                </View>
              ) : (
                medics.map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() => setSelectedMedic(m)}
                    style={[styles.medicRow, selectedMedic?.id === m.id && styles.medicRowSelected]}
                  >
                    <View style={[styles.medicAvatar, selectedMedic?.id === m.id && styles.medicAvatarSelected]}>
                      <Text style={[styles.medicAvatarText, selectedMedic?.id === m.id && { color: "#0f2513" }]}>
                        {m.name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("")}
                      </Text>
                    </View>
                    <View style={styles.medicInfo}>
                      <Text style={[styles.medicName, selectedMedic?.id === m.id && { color: "#fff" }]}>
                        {m.name}
                      </Text>
                      {(m.unit || m.vehicle) && (
                        <Text style={styles.medicSub}>
                          {[m.unit, m.vehicle].filter(Boolean).join(" · ")}
                        </Text>
                      )}
                    </View>
                    {selectedMedic?.id === m.id && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </Pressable>
                ))
              )}
            </View>
          )}

          <Pressable
            onPress={onJoin}
            style={[styles.cta, submitting && styles.ctaDisabled]}
            disabled={submitting}
          >
            <Text style={styles.ctaText}>
              {submitting ? "Connecting…" : mode === "medic" ? "Join as Medic" : "Join Event"}
            </Text>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={styles.envToggle} onPress={() => setShowEnv(v => !v)}>
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
  inputShell: {
    borderRadius: 16, borderWidth: 1, borderColor: "rgba(143,168,199,0.24)",
    backgroundColor: "rgba(6,22,42,0.95)", paddingHorizontal: 14,
    flexDirection: "row", alignItems: "center", marginBottom: 11, minHeight: 56,
  },
  inputIcon: { width: 24, color: "#65d978", fontSize: 17, fontWeight: "700" },
  input: { flex: 1, color: "#ecf5ff", fontSize: 18, fontWeight: "600", paddingVertical: 12, marginLeft: 8 },

  modeRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  modeBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: "center",
    borderWidth: 1, borderColor: "rgba(143,168,199,0.2)",
    backgroundColor: "rgba(6,22,42,0.8)",
  },
  modeBtnActive: {
    backgroundColor: "rgba(105,214,114,0.12)",
    borderColor: "rgba(105,214,114,0.45)",
  },
  modeBtnText: { color: "#7f95aa", fontSize: 15, fontWeight: "700" },
  modeBtnTextActive: { color: "#69d672" },

  rosterShell: {
    borderRadius: 16, borderWidth: 1, borderColor: "rgba(143,168,199,0.18)",
    backgroundColor: "rgba(6,22,42,0.9)", padding: 12, marginBottom: 14,
  },
  rosterLabel: { color: "#65d978", fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 },
  rosterLoading: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  rosterLoadingText: { color: "#7f95aa", fontSize: 14 },
  rosterEmpty: { alignItems: "center", paddingVertical: 16, gap: 10 },
  rosterEmptyText: { color: "#7f95aa", fontSize: 14 },
  retryBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: "rgba(105,214,114,0.4)", backgroundColor: "rgba(105,214,114,0.08)" },
  retryBtnText: { color: "#69d672", fontWeight: "700", fontSize: 13 },

  medicRow: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 10,
    borderRadius: 12, marginBottom: 8,
    borderWidth: 1, borderColor: "transparent",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  medicRowSelected: {
    backgroundColor: "rgba(105,214,114,0.1)",
    borderColor: "rgba(105,214,114,0.35)",
  },
  medicAvatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(105,214,114,0.12)",
    borderWidth: 1.5, borderColor: "rgba(105,214,114,0.3)",
  },
  medicAvatarSelected: { backgroundColor: "#69d672", borderColor: "#69d672" },
  medicAvatarText: { color: "#69d672", fontSize: 13, fontWeight: "800" },
  medicInfo: { flex: 1 },
  medicName: { color: "#c0cfe0", fontSize: 15, fontWeight: "700" },
  medicSub: { color: "#556070", fontSize: 12, marginTop: 1 },
  checkmark: { color: "#69d672", fontSize: 20, fontWeight: "900" },

  cta: {
    marginTop: 8, borderRadius: 16, minHeight: 56,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#69d672",
    shadowColor: "#60dd77", shadowOpacity: 0.38, shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
  ctaDisabled: { opacity: 0.78 },
  ctaText: { color: "#0f2513", fontSize: 21, fontWeight: "900", letterSpacing: 0.3 },
  error: { color: "#fecaca", fontWeight: "700", marginTop: 10, fontSize: 14 },
  envToggle: { marginTop: 12, alignSelf: "center", paddingHorizontal: 10, paddingVertical: 6 },
  envToggleText: { color: "#91a5bc", fontSize: 13, fontWeight: "600" },
  envCard: { marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: "rgba(118,195,130,0.35)", backgroundColor: "rgba(5,20,35,0.95)", padding: 10 },
  envTitle: { color: "#6fda81", fontSize: 11, letterSpacing: 0.6, fontWeight: "800", marginBottom: 6, textTransform: "uppercase" },
  envLine: { color: "#d2d9e2", fontSize: 11, marginBottom: 2 },

});
