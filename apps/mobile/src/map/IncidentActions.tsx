import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { getSocket } from "../realtime/socket-client";
import {
  archiveIncident,
  closeIncident,
  listIncidentMessages,
  patchIncident,
  sendIncidentMessage,
  type IncidentMessageDto,
} from "../ui/event-actions";
import { AssignDestinationBar } from "./AssignDestinationBar";
import { debugLog } from "../debug/debug-log";

const CATEGORIES: Array<{ id: string; label: string; icon: string }> = [
  { id: "medical", label: "Medical", icon: "🏥" },
  { id: "cardiac", label: "Cardiac", icon: "❤️" },
  { id: "trauma", label: "Trauma", icon: "🩹" },
  { id: "fracture", label: "Fracture", icon: "🦴" },
  { id: "unconscious", label: "Unconscious", icon: "😵" },
  { id: "other", label: "Other", icon: "⚠️" },
];

interface Props {
  incidentId: string;
  lat: number;
  lng: number;
  label: string;
  currentType?: string;
  onClosed?: () => void;
}

export function IncidentActions({ incidentId, lat, lng, label, currentType, onClosed }: Props) {
  const [tab, setTab] = useState<"actions" | "chat">("actions");
  const [messages, setMessages] = useState<IncidentMessageDto[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [vitals, setVitals] = useState("");
  const [treatment, setTreatment] = useState("");
  const [transport, setTransport] = useState("");
  const [closing, setClosing] = useState(false);
  const [category, setCategory] = useState<string>(currentType ?? "other");
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    setCategory(currentType ?? "other");
  }, [currentType, incidentId]);

  const selectCategory = (id: string) => {
    if (id === category) return;
    setCategory(id);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void patchIncident(incidentId, { type: id }).catch((err) =>
      debugLog("api", "error", "update category failed", String(err)),
    );
  };

  const archive = async () => {
    if (archiving) return;
    setArchiving(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await archiveIncident(incidentId);
      onClosed?.();
    } catch (err) {
      debugLog("api", "error", "archive incident failed", String(err));
      setArchiving(false);
    }
  };

  useEffect(() => {
    let active = true;
    void listIncidentMessages(incidentId)
      .then((list) => active && setMessages(list))
      .catch((err) => debugLog("api", "error", "load messages failed", String(err)));

    const socket = getSocket();
    const onMessage = (msg: IncidentMessageDto) => {
      if (msg.incidentId !== incidentId) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    };
    socket.on("incident.message", onMessage);
    return () => {
      active = false;
      socket.off("incident.message", onMessage);
    };
  }, [incidentId]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const msg = await sendIncidentMessage(incidentId, text);
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      setDraft("");
    } catch (err) {
      debugLog("api", "error", "send message failed", String(err));
    } finally {
      setSending(false);
    }
  };

  const submitClose = async () => {
    setClosing(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await closeIncident(incidentId, {
        vitals: vitals.trim() || undefined,
        treatment: treatment.trim() || undefined,
        transport: transport.trim() || undefined,
      });
      onClosed?.();
    } catch (err) {
      debugLog("api", "error", "close incident failed", String(err));
    } finally {
      setClosing(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.tabRow}>
        {(["actions", "chat"] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === "actions" ? "Respond" : `Chat${messages.length ? ` (${messages.length})` : ""}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === "actions" ? (
        <>
          <Text style={styles.sectionLabel}>CATEGORY</Text>
          <View style={styles.catRow}>
            {CATEGORIES.map((c) => {
              const active = category === c.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => selectCategory(c.id)}
                  style={[styles.catChip, active && styles.catChipActive]}
                >
                  <Text style={styles.catIcon}>{c.icon}</Text>
                  <Text style={[styles.catText, active && styles.catTextActive]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <AssignDestinationBar destination={{ lat, lng, label }} incidentId={incidentId} />

          {!showClose ? (
            <Pressable style={[styles.btn, styles.closeBtn]} onPress={() => setShowClose(true)}>
              <Text style={styles.closeBtnText}>Close with handover</Text>
            </Pressable>
          ) : (
            <View style={styles.closeForm}>
              <Text style={styles.formLabel}>CASUALTY HANDOVER</Text>
              <BottomSheetTextInput style={styles.input} placeholder="Vitals — BP, HR, SpO₂…" placeholderTextColor="#475569" value={vitals} onChangeText={setVitals} />
              <BottomSheetTextInput style={styles.input} placeholder="Treatment given" placeholderTextColor="#475569" value={treatment} onChangeText={setTreatment} />
              <BottomSheetTextInput style={styles.input} placeholder="Transport — self-care / ambulance…" placeholderTextColor="#475569" value={transport} onChangeText={setTransport} />
              <View style={styles.closeFormBtns}>
                <Pressable style={[styles.btn, styles.confirmCloseBtn]} onPress={submitClose} disabled={closing}>
                  <Text style={styles.confirmCloseText}>{closing ? "Closing…" : "Close incident"}</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.cancelBtn]} onPress={() => setShowClose(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}

          {!showClose ? (
            <Pressable style={styles.archiveBtn} onPress={archive} disabled={archiving}>
              <Text style={styles.archiveBtnText}>{archiving ? "Archiving…" : "🗄  Archive incident"}</Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <View style={styles.chat}>
          {messages.length === 0 ? (
            <Text style={styles.chatEmpty}>No messages yet. Coordinate with the team.</Text>
          ) : (
            messages.map((m) => (
              <View key={m.id} style={styles.msg}>
                <Text style={styles.msgAuthor}>{m.authorName}</Text>
                <Text style={styles.msgText}>{m.text}</Text>
              </View>
            ))
          )}
          <View style={styles.composer}>
            <BottomSheetTextInput
              style={styles.composerInput}
              placeholder="Message the team…"
              placeholderTextColor="#475569"
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={send}
              returnKeyType="send"
            />
            <Pressable style={styles.sendBtn} onPress={send} disabled={!draft.trim() || sending}>
              {sending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sendBtnText}>➤</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, gap: 10 },
  tabRow: { flexDirection: "row", gap: 4, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  tabActive: { backgroundColor: "rgba(34,197,94,0.16)" },
  tabText: { color: "#64748b", fontSize: 12, fontWeight: "800" },
  tabTextActive: { color: "#34d399" },
  btn: { paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  closeBtn: { backgroundColor: "#16a34a" },
  closeBtnText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  sectionLabel: { color: "#64748b", fontSize: 10, fontWeight: "800", letterSpacing: 1, marginBottom: 2 },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  catChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  catChipActive: { borderColor: "#34d399", backgroundColor: "rgba(34,197,94,0.16)" },
  catIcon: { fontSize: 13 },
  catText: { color: "#94a3b8", fontSize: 12, fontWeight: "800" },
  catTextActive: { color: "#34d399" },
  archiveBtn: {
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.22)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  archiveBtnText: { color: "#94a3b8", fontSize: 13, fontWeight: "800" },
  closeForm: { gap: 8, backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 10 },
  formLabel: { color: "#64748b", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.15)",
    color: "#e2e8f0",
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  closeFormBtns: { flexDirection: "row", gap: 8 },
  confirmCloseBtn: { flex: 1, backgroundColor: "#16a34a" },
  confirmCloseText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  cancelBtn: { paddingHorizontal: 16, backgroundColor: "rgba(255,255,255,0.05)" },
  cancelText: { color: "#64748b", fontSize: 13, fontWeight: "700" },
  chat: { gap: 8 },
  chatEmpty: { color: "#475569", fontSize: 12, textAlign: "center", paddingVertical: 16 },
  msg: { backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 10 },
  msgAuthor: { color: "#93c5fd", fontSize: 11, fontWeight: "800", marginBottom: 2 },
  msgText: { color: "#cbd5e1", fontSize: 13 },
  composer: { flexDirection: "row", gap: 8, alignItems: "center" },
  composerInput: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.15)",
    color: "#e2e8f0",
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center" },
  sendBtnText: { color: "#fff", fontSize: 16, fontWeight: "900" },
});
