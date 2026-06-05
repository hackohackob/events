import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { incidentQueue, type PersistentQueueItem } from "./persistent-incident-queue";
import { flushIncidentQueue } from "./flush-incidents";
import { freshnessLabel } from "../map/freshness";

function statusOf(item: PersistentQueueItem): { label: string; color: string } {
  if (item.failedPermanently) return { label: "Failed", color: "#ff6b6b" };
  if (item.attempts > 0) return { label: `Retrying (${item.attempts})`, color: "#f5c518" };
  return { label: "Pending", color: "#f97316" };
}

export function PendingIncidentsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [items, setItems] = useState<PersistentQueueItem[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = () => setItems(incidentQueue.list());

  useEffect(() => {
    if (!visible) return;
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [visible]);

  const retryAll = async () => {
    setBusy(true);
    // Reset permanently-failed items so they become eligible again.
    for (const item of incidentQueue.list()) {
      if (item.failedPermanently) await incidentQueue.retry(item.id);
    }
    await flushIncidentQueue();
    refresh();
    setBusy(false);
  };

  const discard = async (id: string) => {
    await incidentQueue.remove(id);
    refresh();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Pending incident reports</Text>
          <Text style={styles.subtitle}>
            {items.length === 0 ? "Nothing waiting to send." : `${items.length} report${items.length > 1 ? "s" : ""} not yet delivered`}
          </Text>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {items.map((item) => {
              const status = statusOf(item);
              const ageMs = Date.now() - item.createdAt;
              return (
                <View key={item.id} style={styles.item}>
                  <View style={styles.itemHead}>
                    <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                    <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
                    <Text style={styles.itemTime}>{freshnessLabel(ageMs)}</Text>
                  </View>
                  <Text style={styles.itemCoords}>
                    {item.payload.lat.toFixed(5)}, {item.payload.lng.toFixed(5)}
                  </Text>
                  {item.lastError ? <Text style={styles.itemError} numberOfLines={2}>{item.lastError}</Text> : null}
                  <Pressable style={styles.discardBtn} onPress={() => void discard(item.id)}>
                    <Text style={styles.discardText}>Discard</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable style={styles.secondaryBtn} onPress={onClose}>
              <Text style={styles.secondaryBtnText}>Close</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, (busy || items.length === 0) && styles.btnDisabled]}
              onPress={() => void retryAll()}
              disabled={busy || items.length === 0}
            >
              <Text style={styles.primaryBtnText}>{busy ? "Sending…" : "Retry now"}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#0b1729",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 32,
    maxHeight: "75%",
  },
  handle: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: "rgba(177,199,224,0.28)", marginBottom: 14 },
  title: { color: "#eff6ff", fontSize: 18, fontWeight: "900" },
  subtitle: { color: "#6b7f9a", fontSize: 13, fontWeight: "500", marginTop: 4, marginBottom: 14 },
  list: { flexGrow: 0 },
  listContent: { gap: 10 },
  item: { backgroundColor: "#101d32", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "rgba(177,199,224,0.1)" },
  itemHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, fontWeight: "800" },
  itemTime: { color: "#5f7da0", fontSize: 11, fontWeight: "600", marginLeft: "auto" },
  itemCoords: { color: "#cdd9e8", fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  itemError: { color: "#ff8f8f", fontSize: 11, marginTop: 4 },
  discardBtn: { alignSelf: "flex-start", marginTop: 8 },
  discardText: { color: "#6b7f9a", fontSize: 12, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 12, marginTop: 16 },
  secondaryBtn: { flex: 1, backgroundColor: "#16263d", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  secondaryBtnText: { color: "#9fb3cc", fontSize: 14, fontWeight: "800" },
  primaryBtn: { flex: 1, backgroundColor: "#00C37A", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  btnDisabled: { opacity: 0.5 },
});
