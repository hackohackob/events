import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { createPoi, type PoiDto } from "../ui/event-actions";
import { debugLog } from "../debug/debug-log";

const POI_TYPES: Array<{ id: string; label: string; icon: string; color: string }> = [
  { id: "medical-point", label: "Medical", icon: "✚", color: "#ef4444" },
  { id: "ambulance", label: "Ambulance", icon: "🚑", color: "#ef4444" },
  { id: "danger", label: "Danger", icon: "⚠️", color: "#f43f5e" },
  { id: "road-crossing", label: "Crossing", icon: "🚧", color: "#f59e0b" },
  { id: "water-point", label: "Water", icon: "💧", color: "#3b82f6" },
  { id: "food-point", label: "Food", icon: "🍌", color: "#22c55e" },
  { id: "mechanical", label: "Mechanic", icon: "🔧", color: "#64748b" },
  { id: "marshal", label: "Marshal", icon: "🚩", color: "#3b82f6" },
  { id: "checkpoint", label: "Checkpoint", icon: "⏱️", color: "#a855f7" },
  { id: "finish", label: "Finish", icon: "🏁", color: "#10b981" },
  { id: "shelter", label: "Shelter", icon: "⛺", color: "#0ea5e9" },
  { id: "wc", label: "WC", icon: "🚻", color: "#8b5cf6" },
  { id: "parking", label: "Parking", icon: "🅿️", color: "#f59e0b" },
  { id: "custom", label: "Other", icon: "★", color: "#94a3b8" },
];

interface Props {
  pending: { lat: number; lng: number } | null;
  onClose: () => void;
  onCreated: (poi: PoiDto) => void;
}

export function NewPoiSheet({ pending, onClose, onCreated }: Props) {
  const [type, setType] = useState("medical-point");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset the form each time a fresh long-press opens it.
  useEffect(() => {
    if (pending) {
      setType("medical-point");
      setName("");
      setDescription("");
      setSaving(false);
    }
  }, [pending]);

  const submit = async () => {
    if (!pending || saving) return;
    setSaving(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const poi = await createPoi({
        lat: pending.lat,
        lng: pending.lng,
        type,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onCreated(poi);
    } catch (err) {
      debugLog("api", "error", "create POI failed", String(err));
      setSaving(false);
    }
  };

  return (
    <Modal visible={!!pending} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.centerWrap}
        >
          {/* Stop propagation so taps inside the card don't dismiss. */}
          <Pressable style={styles.card} onPress={() => {}}>
            <View style={styles.grabber} />
            {/* Scrollable so the keyboard can't bury the name/description
                fields — the focused input scrolls up above it. */}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.cardScrollContent}
            >
            <Text style={styles.title}>New point of interest</Text>
            <Text style={styles.subtitle}>
              {pending ? `${pending.lat.toFixed(5)}, ${pending.lng.toFixed(5)}` : ""}
            </Text>

            <Text style={styles.label}>TYPE</Text>
            <View style={styles.typeRow}>
              {POI_TYPES.map((t) => {
                const active = type === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => {
                      setType(t.id);
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={[styles.typeChip, active && { borderColor: t.color, backgroundColor: `${t.color}22` }]}
                  >
                    <Text style={styles.typeIcon}>{t.icon}</Text>
                    <Text style={[styles.typeText, active && { color: t.color }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.label}>NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Aid station 2"
              placeholderTextColor="#475569"
              value={name}
              onChangeText={setName}
              returnKeyType="next"
            />

            <Text style={styles.label}>DESCRIPTION (OPTIONAL)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="Anything the team should know…"
              placeholderTextColor="#475569"
              value={description}
              onChangeText={setDescription}
              multiline
              textAlignVertical="top"
            />

            <Pressable style={[styles.createBtn, saving && styles.createBtnDisabled]} onPress={submit} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color="#04121f" />
              ) : (
                <Text style={styles.createBtnText}>Add point</Text>
              )}
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(2,6,16,0.62)" },
  centerWrap: { flex: 1, justifyContent: "flex-end" },
  card: {
    backgroundColor: "#090f1d",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: "rgba(180,201,223,0.22)",
    paddingHorizontal: 20,
    paddingTop: 10,
    // Cap height so the inner ScrollView is bounded and can scroll the fields
    // clear of the keyboard.
    maxHeight: "88%",
  },
  cardScrollContent: { paddingBottom: 28 },
  grabber: {
    alignSelf: "center",
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(177,199,224,0.28)",
    marginBottom: 14,
  },
  title: { color: "#EFF6FF", fontSize: 20, fontWeight: "900", letterSpacing: 0.2 },
  subtitle: { color: "#64748b", fontSize: 12.5, fontWeight: "700", marginTop: 3 },
  label: { color: "#4A5F7A", fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginTop: 18, marginBottom: 9 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "rgba(148,163,184,0.18)",
    backgroundColor: "#101d32",
  },
  typeIcon: { fontSize: 14 },
  typeText: { color: "#94a3b8", fontSize: 12.5, fontWeight: "800" },
  input: {
    backgroundColor: "#101d32",
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(177,199,224,0.12)",
    color: "#EFF6FF",
    fontSize: 14,
    fontWeight: "500",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputMultiline: { minHeight: 72 },
  createBtn: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#34d399",
    borderRadius: 16,
    paddingVertical: 15,
    shadowColor: "#34d399",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  createBtnDisabled: { backgroundColor: "#1f4f43" },
  createBtnText: { color: "#04121f", fontSize: 16, fontWeight: "900", letterSpacing: 0.3 },
  cancelBtn: { alignItems: "center", paddingVertical: 13, marginTop: 2 },
  cancelText: { color: "#64748b", fontSize: 13, fontWeight: "700" },
});
