import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { apiFetch } from "../ui/api-client";
import { OfflineQueue } from "../offline/offline-queue";

const incidentQueue = new OfflineQueue<Record<string, unknown>>();

export function IncidentsScreen() {
  const [type, setType] = useState("medical");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    setMessage(null);
    const payload = {
      lat: 42.6977,
      lng: 23.3219,
      type,
      description,
      severity: "medium",
    };
    try {
      await apiFetch("/incidents", { method: "POST", body: JSON.stringify(payload) });
      setMessage("Incident submitted");
    } catch {
      incidentQueue.enqueue("incident.create", payload);
      setMessage("No connection. Incident queued.");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Report Incident</Text>
        <Text style={styles.subtitle}>Instantly notify medical teams from your current location.</Text>
        <TextInput value={type} onChangeText={setType} style={styles.input} placeholder="Type" />
        <TextInput
          value={description}
          onChangeText={setDescription}
          style={[styles.input, styles.descriptionInput]}
          placeholder="Description"
          multiline
        />
        <Pressable onPress={submit} style={styles.button}>
          <Text style={styles.buttonText}>Submit Incident</Text>
        </Pressable>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 4 },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  title: { fontSize: 24, fontWeight: "800", color: "#0f172a" },
  subtitle: { color: "#64748b", marginTop: 4, marginBottom: 14 },
  input: {
    borderWidth: 1,
    borderColor: "#d1dbe8",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    backgroundColor: "#f8fafc",
  },
  descriptionInput: { minHeight: 90, textAlignVertical: "top" },
  button: {
    marginTop: 4,
    backgroundColor: "#dc2626",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonText: { color: "#ffffff", fontWeight: "800", fontSize: 15 },
  message: { marginTop: 10, color: "#0f766e", fontWeight: "700" },
});
