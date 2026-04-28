import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { joinEvent } from "./join-event";
import { useSessionStore } from "../security/session-store";

function maskValue(value: string, visibleStart = 10, visibleEnd = 4): string {
  if (!value) {
    return "(empty)";
  }
  if (value.length <= visibleStart + visibleEnd) {
    return value;
  }
  return `${value.slice(0, visibleStart)}...${value.slice(-visibleEnd)}`;
}

export function JoinScreen() {
  const [joinCode, setJoinCode] = useState("event-demo");
  const [name, setName] = useState("Nasko");
  const [bibNumber, setBibNumber] = useState("1020");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showEnv, setShowEnv] = useState(false);
  const setSession = useSessionStore((state) => state.setSession);

  const cardEntrance = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  const loadedEnv = {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "",
    wsUrl: process.env.EXPO_PUBLIC_WS_URL ?? "",
    mapyApiKey: process.env.EXPO_PUBLIC_MAPY_API_KEY ?? "",
    googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
  };

  useEffect(() => {
    Animated.timing(cardEntrance, {
      toValue: 1,
      duration: 760,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 2100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 2100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [cardEntrance, pulse]);

  const onJoin = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const response = await joinEvent({ joinCode, name, bibNumber });
      setSession({
        token: response.token,
        eventId: response.session.eventId,
        role: response.session.role,
      });
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Unable to join event");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.container}>
      <View style={styles.background}>
        <Animated.View
          style={[
            styles.glow,
            styles.glowTop,
            {
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.18],
                  }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.glow,
            styles.glowBottom,
            {
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1.05, 0.88],
                  }),
                },
              ],
            },
          ]}
        />
      </View>

      <Animated.View
        style={[
          styles.card,
          {
            opacity: cardEntrance,
            transform: [
              {
                translateY: cardEntrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [28, 0],
                }),
              },
            ],
          },
        ]}
      >
        {/* <Text style={styles.heroTitle}>Together on the course.</Text> */}
        <Text style={styles.heroAccent}>Ready when it matters.</Text>
        <Text style={styles.subtitle}>Real-time coordination for medical teams during races and outdoor events.</Text>

        {/* <Text style={styles.sectionTitle}>Welcome back</Text> */}

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
            placeholder="Bib / Unit number"
            placeholderTextColor="#7f95aa"
            style={styles.input}
          />
        </View>

        <Pressable onPress={onJoin} style={[styles.cta, submitting ? styles.ctaDisabled : null]} disabled={submitting}>
          <Text style={styles.ctaText}>{submitting ? "Connecting..." : "Join Event"}</Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.envToggle} onPress={() => setShowEnv((current) => !current)}>
          <Text style={styles.envToggleText}>{showEnv ? "Hide diagnostics" : "Show diagnostics"}</Text>
        </Pressable>

        {showEnv ? (
          <View style={styles.envCard}>
            <Text style={styles.envTitle}>Runtime configuration</Text>
            <Text style={styles.envLine}>API: {loadedEnv.apiUrl || "(empty)"}</Text>
            <Text style={styles.envLine}>WS: {loadedEnv.wsUrl || "(empty)"}</Text>
            <Text style={styles.envLine}>MAPY: {maskValue(loadedEnv.mapyApiKey)}</Text>
            <Text style={styles.envLine}>GOOGLE: {maskValue(loadedEnv.googleMapsApiKey)}</Text>
          </View>
        ) : null}
      </Animated.View>

      {/* <Text style={styles.footerVersion}>SYSTEMS NOMINAL | V2.4.0-STABLE</Text> */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#030d1f",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#030d1f",
  },
  glow: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "rgba(66, 162, 92, 0.26)",
  },
  glowTop: {
    width: 280,
    height: 280,
    top: -80,
    right: -70,
  },
  glowBottom: {
    width: 320,
    height: 320,
    bottom: -120,
    left: -100,
    backgroundColor: "rgba(52, 116, 194, 0.28)",
  },
  topStrip: {
    marginBottom: 16,
    alignItems: "center",
    gap: 8,
  },
  brandPill: {
    color: "#d9e8f7",
    fontWeight: "700",
    letterSpacing: 1.1,
    fontSize: 12,
    borderWidth: 1,
    borderColor: "rgba(154, 178, 206, 0.4)",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "rgba(7, 24, 46, 0.75)",
  },
  brandSub: {
    color: "#6be27f",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  card: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(140, 160, 186, 0.24)",
    backgroundColor: "rgba(5, 17, 35, 0.82)",
    padding: 20,
    shadowColor: "#020914",
    shadowOpacity: 0.32,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 15,
  },
  heroTitle: {
    color: "#f3f8ff",
    fontSize: 32,
    fontWeight: "800",
    lineHeight: 36,
  },
  heroAccent: {
    marginTop: 2,
    color: "#69dc7d",
    fontSize: 31,
    fontWeight: "900",
    lineHeight: 35,
  },
  subtitle: {
    color: "#b7c7d8",
    fontSize: 15,
    lineHeight: 21,
    marginTop: 10,
    marginBottom: 16,
  },
  sectionTitle: {
    color: "#f0f6ff",
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 12,
  },
  inputShell: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(143, 168, 199, 0.24)",
    backgroundColor: "rgba(6, 22, 42, 0.95)",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 11,
    minHeight: 56,
  },
  inputIcon: {
    width: 24,
    color: "#65d978",
    fontSize: 17,
    fontWeight: "700",
  },
  input: {
    flex: 1,
    color: "#ecf5ff",
    fontSize: 18,
    fontWeight: "600",
    paddingVertical: 12,
    marginLeft: 8,
  },
  cta: {
    marginTop: 8,
    borderRadius: 16,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#69d672",
    shadowColor: "#60dd77",
    shadowOpacity: 0.38,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  ctaDisabled: {
    opacity: 0.78,
  },
  ctaText: {
    color: "#0f2513",
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  error: {
    color: "#fecaca",
    fontWeight: "700",
    marginTop: 10,
    fontSize: 14,
  },
  envToggle: {
    marginTop: 12,
    alignSelf: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  envToggleText: {
    color: "#91a5bc",
    fontSize: 13,
    fontWeight: "600",
  },
  envCard: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(118, 195, 130, 0.35)",
    backgroundColor: "rgba(5, 20, 35, 0.95)",
    padding: 10,
  },
  envTitle: {
    color: "#6fda81",
    fontSize: 11,
    letterSpacing: 0.6,
    fontWeight: "800",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  envLine: {
    color: "#d2d9e2",
    fontSize: 11,
    marginBottom: 2,
  },
  footerVersion: {
    marginTop: 14,
    textAlign: "center",
    color: "rgba(145, 169, 196, 0.9)",
    fontSize: 11,
    letterSpacing: 0.8,
    fontWeight: "700",
  },
});
