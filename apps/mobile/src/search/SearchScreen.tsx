import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { apiFetch } from "../ui/api-client";

interface RunnerResult {
  userId: string;
  name: string;
  bibNumber: string;
  lastLat: number;
  lastLng: number;
  lastUpdate: string;
}

export function SearchScreen() {
  const [bibNumber, setBibNumber] = useState("");
  const [results, setResults] = useState<RunnerResult[]>([]);

  const runSearch = async () => {
    const params = new URLSearchParams();
    if (bibNumber) params.set("bibNumber", bibNumber);
    const data = await apiFetch<RunnerResult[]>(`/search/runners?${params.toString()}`);
    setResults(data);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerCard}>
        <Text style={styles.title}>Runner Search</Text>
        <Text style={styles.subtitle}>Find runner status by bib number.</Text>
        <TextInput
          value={bibNumber}
          onChangeText={setBibNumber}
          style={styles.input}
          placeholder="Bib Number"
          keyboardType="numeric"
        />
        <Pressable onPress={runSearch} style={styles.searchButton}>
          <Text style={styles.searchButtonText}>Search</Text>
        </Pressable>
      </View>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={results}
        keyExtractor={(item: RunnerResult) => item.userId}
        renderItem={({ item }: { item: RunnerResult }) => (
          <View style={styles.card}>
            <Text style={styles.runnerName}>
              {item.name} #{item.bibNumber}
            </Text>
            <Text style={styles.runnerMeta}>
              {item.lastLat.toFixed(5)}, {item.lastLng.toFixed(5)}
            </Text>
            <Text style={styles.runnerMeta}>Updated: {new Date(item.lastUpdate).toLocaleTimeString()}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 12, paddingTop: 4 },
  headerCard: {
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
  subtitle: { color: "#64748b", marginTop: 4, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#d1dbe8",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#f8fafc",
  },
  searchButton: {
    marginTop: 10,
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  searchButtonText: { color: "#ffffff", fontWeight: "800", fontSize: 15 },
  listContent: { paddingBottom: 50 },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
    shadowColor: "#0f172a",
    shadowOpacity: 0.05,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  runnerName: { fontWeight: "800", color: "#0f172a", fontSize: 16 },
  runnerMeta: { color: "#475569", marginTop: 2 },
});
