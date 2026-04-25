import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { joinEvent } from "./join-event";
import { useSessionStore } from "../security/session-store";

export function JoinScreen() {
  const [joinCode, setJoinCode] = useState("event-demo");
  const [name, setName] = useState("Nasko");
  const [bibNumber, setBibNumber] = useState("1020");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const setSession = useSessionStore((state) => state.setSession);

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
      <View style={styles.topStrip}>
        {/* <Text style={styles.topStripItem}>MISSION: ACTIVE</Text> */}
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={styles.topStripItem}>ACADEMY FIRST AID</Text>
        </View>
   
      </View>

      <View style={styles.card}>
        {/* <Text style={styles.title}>Mission Check-in</Text> */}
        <Text style={styles.subtitle}>Verify credentials to join active event operations.</Text>

        <Text style={styles.label}>EVENT CODE</Text>
        <TextInput
          value={joinCode}
          onChangeText={setJoinCode}
          placeholder="E.G. MAR-2024-LON"
          placeholderTextColor="#4c5560"
          style={styles.input}
          autoCapitalize="none"
        />

        <Text style={styles.label}>FULL NAME</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="ENTER LEGAL NAME"
          placeholderTextColor="#4c5560"
          style={styles.input}
        />

        <Text style={styles.label}>BIB / UNIT NUMBER</Text>
        <TextInput
          value={bibNumber}
          onChangeText={setBibNumber}
          placeholder="E.G. MED-14"
          placeholderTextColor="#4c5560"
          style={styles.input}
        />

        <Pressable onPress={onJoin} style={[styles.cta, submitting ? styles.ctaDisabled : null]} disabled={submitting}>
          <Text style={styles.ctaText}>{submitting ? "JOINING..." : "JOIN EVENT"}</Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.footerLinks}>
          {/* <Text style={styles.footerLink}>Technical Support</Text>
          <Text style={styles.footerLink}>Event Protocol</Text> */}
        </View>
      </View>

      <Text style={styles.footerVersion}>SYSTEMS NOMINAL    |    V2.4.0-STABLE</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1c2128",
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  topStrip: {
    height: 42,
    backgroundColor: "#1b232d",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(89, 249, 121, 0.2)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  topStripItem: {
    color: "#5fe073",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  card: {
    backgroundColor: "#3a3f47",
    borderRadius: 0,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(102, 113, 128, 0.35)",
    marginHorizontal: 6,
  },
  title: { fontSize: 42, letterSpacing: 0.2, fontWeight: "800", color: "#e9edf2", textAlign: "center" },
  subtitle: {
    marginTop: 6,
    marginBottom: 10,
    color: "#c9d0d8",
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "500",
    textAlign: "center",
  },
  label: {
    color: "#63d377",
    fontWeight: "700",
    marginBottom: 7,
    marginTop: 12,
    letterSpacing: 1,
    fontSize: 17,
  },
  input: {
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#181b21",
    color: "#f1f5f9",
    fontSize: 22,
    fontWeight: "700",
  },
  cta: {
    marginTop: 20,
    backgroundColor: "#5ecb67",
    borderRadius: 0,
    paddingVertical: 18,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.75 },
  ctaText: { color: "#0f2110", fontSize: 24, fontWeight: "900", letterSpacing: 1 },
  error: { color: "#fecaca", fontWeight: "700", marginTop: 12, fontSize: 15 },
  footerLinks: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  footerLink: { color: "#d8dee7", fontSize: 12, fontWeight: "500" },
  footerVersion: {
    marginTop: 14,
    textAlign: "center",
    color: "#56d16c",
    fontSize: 12,
    letterSpacing: 1.2,
    fontWeight: "600",
  },
});
