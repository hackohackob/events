import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from "expo-audio";
import { resolveMediaUrl } from "../ui/api-client";
import { useSessionStore } from "../security/session-store";
import { getSocket } from "../realtime/socket-client";
import { debugLog } from "../debug/debug-log";
import {
  listEventMessages,
  sendEventMessage,
  uploadEventVoice,
  type EventFeedType,
  type EventMessageDto,
} from "./event-chat-api";

const FEED_META: Record<EventFeedType, { icon: keyof typeof Feather.glyphMap; color: string; label: string }> = {
  incident: { icon: "alert-triangle", color: "#f87171", label: "Incident" },
  response: { icon: "navigation", color: "#60a5fa", label: "Responding" },
  poi: { icon: "map-pin", color: "#34d399", label: "New point" },
};

const AVATAR_COLORS = ["#0f6e56", "#185fa5", "#7c3aed", "#b45309", "#9d174d", "#0e7490", "#4d7c0f"];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function formatDuration(ms?: number): string {
  const s = Math.max(1, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

interface Row {
  msg: EventMessageDto;
  showHeader: boolean; // author name + avatar (grouping)
  dateSep: string | null; // day label when the day changes
  mine: boolean;
}

const MIN_VOICE_MS = 800;

export function EventChatScreen({ onClose }: { onClose: () => void }) {
  const myId = useSessionStore((s) => s.userId);
  const [messages, setMessages] = useState<EventMessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);

  // ── Load history + live updates ────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    listEventMessages()
      .then((list) => alive && setMessages(list))
      .catch((err) => debugLog("api", "error", "event chat load failed", String(err)))
      .finally(() => alive && setLoading(false));

    const socket = getSocket();
    const onMessage = (msg: EventMessageDto) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    };
    socket.on("event.message", onMessage);
    return () => {
      alive = false;
      socket.off("event.message", onMessage);
    };
  }, []);

  // Build display rows with grouping + date separators.
  const rows = useMemo<Row[]>(() => {
    return messages.map((msg, i) => {
      const prev = messages[i - 1];
      const mine = msg.authorId != null && msg.authorId === myId;
      const gapMin = prev ? (new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime()) / 60000 : 999;
      const showHeader =
        msg.kind !== "system" &&
        (!prev || prev.kind === "system" || prev.authorId !== msg.authorId || gapMin > 5);
      const dateSep = !prev || dayLabel(prev.createdAt) !== dayLabel(msg.createdAt) ? dayLabel(msg.createdAt) : null;
      return { msg, showHeader, dateSep, mine };
    });
  }, [messages, myId]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    try {
      const msg = await sendEventMessage(text);
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    } catch (err) {
      debugLog("api", "error", "event chat send failed", String(err));
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.iconBtn} onPress={onClose} hitSlop={8}>
          <Feather name="chevron-left" size={22} color="#e8eef7" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Team chat</Text>
          <Text style={styles.subtitle}>Everyone on the event · live feed</Text>
        </View>
        <View style={styles.headerBadge}>
          <Feather name="message-circle" size={17} color="#34d399" />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#34d399" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(r) => r.msg.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <MessageRow row={item} />}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Feather name="message-square" size={30} color="#26384f" />
              <Text style={styles.emptyText}>No messages yet</Text>
              <Text style={styles.emptySub}>Say hello to the team — incidents and new points show up here too.</Text>
            </View>
          }
          keyboardShouldPersistTaps="handled"
        />
      )}

      <Composer draft={draft} setDraft={setDraft} onSend={send} sending={sending} onVoice={(m) =>
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
      } />
    </KeyboardAvoidingView>
  );
}

function MessageRow({ row }: { row: Row }) {
  const { msg } = row;
  return (
    <View>
      {row.dateSep ? (
        <View style={styles.dateSep}>
          <View style={styles.dateLine} />
          <Text style={styles.dateText}>{row.dateSep}</Text>
          <View style={styles.dateLine} />
        </View>
      ) : null}
      {msg.kind === "system" ? (
        <SystemCard msg={msg} />
      ) : (
        <ChatBubble row={row} />
      )}
    </View>
  );
}

function SystemCard({ msg }: { msg: EventMessageDto }) {
  const meta = FEED_META[msg.feedType ?? "incident"];
  return (
    <View style={styles.systemRow}>
      <View style={[styles.systemCard, { borderColor: `${meta.color}44`, backgroundColor: `${meta.color}12` }]}>
        <View style={[styles.systemIcon, { backgroundColor: `${meta.color}22`, borderColor: `${meta.color}55` }]}>
          <Feather name={meta.icon} size={14} color={meta.color} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.systemLabel, { color: meta.color }]}>{meta.label}</Text>
          <Text style={styles.systemText}>{msg.text}</Text>
        </View>
        <Text style={styles.systemTime}>{formatTime(msg.createdAt)}</Text>
      </View>
    </View>
  );
}

function ChatBubble({ row }: { row: Row }) {
  const { msg, mine, showHeader } = row;
  const name = msg.authorName || "Team";
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowOther]}>
      {!mine ? (
        <View style={styles.avatarSlot}>
          {showHeader ? (
            <View style={[styles.avatar, { backgroundColor: avatarColor(name) }]}>
              <Text style={styles.avatarText}>{initials(name)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={{ maxWidth: "78%" }}>
        {showHeader && !mine ? <Text style={styles.author}>{name}</Text> : null}
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
          {msg.audioUrl ? (
            <VoiceContent msg={msg} mine={mine} />
          ) : (
            <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{msg.text}</Text>
          )}
          <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>{formatTime(msg.createdAt)}</Text>
        </View>
      </View>
    </View>
  );
}

function VoiceContent({ msg, mine }: { msg: EventMessageDto; mine: boolean }) {
  const player = useAudioPlayer();
  const status = useAudioPlayerStatus(player);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (status.didJustFinish) setPlaying(false);
  }, [status.didJustFinish]);

  const toggle = () => {
    if (playing) {
      player.pause();
      setPlaying(false);
      return;
    }
    const url = resolveMediaUrl(msg.audioUrl);
    if (!url) return;
    player.replace({ uri: url });
    player.play();
    setPlaying(true);
  };

  const tint = mine ? "#04121f" : "#34d399";
  return (
    <View>
      <Pressable style={styles.voiceRow} onPress={toggle}>
        <View style={[styles.voicePlay, { backgroundColor: mine ? "#04121f" : "#34d399" }]}>
          <Feather name={playing ? "pause" : "play"} size={13} color={mine ? "#34d399" : "#04121f"} />
        </View>
        <Waveform active={playing} tint={tint} />
        <Text style={[styles.voiceDur, { color: mine ? "rgba(4,18,31,0.75)" : "#9fb3cc" }]}>
          {formatDuration(msg.audioDurationMs)}
        </Text>
      </Pressable>
      {msg.transcript ? (
        <Text style={[styles.transcript, mine && { color: "rgba(4,18,31,0.78)" }]}>
          <Feather name="file-text" size={10} color={mine ? "rgba(4,18,31,0.6)" : "#64748b"} /> {msg.transcript}
        </Text>
      ) : null}
    </View>
  );
}

const BAR_HEIGHTS = [8, 14, 10, 17, 12, 16, 9, 13, 18, 11, 15, 8];
function Waveform({ active, tint }: { active: boolean; tint: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (active) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: 550, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 550, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    anim.setValue(0);
  }, [active, anim]);

  return (
    <View style={styles.waveform}>
      {BAR_HEIGHTS.map((h, i) => {
        const scale = active
          ? anim.interpolate({ inputRange: [0, 1], outputRange: [1, i % 2 === 0 ? 0.5 : 1.5] })
          : 1;
        return (
          <Animated.View
            key={i}
            style={[styles.waveBar, { height: h, backgroundColor: tint, opacity: active ? 1 : 0.55, transform: [{ scaleY: scale }] }]}
          />
        );
      })}
    </View>
  );
}

function Composer({
  draft,
  setDraft,
  onSend,
  sending,
  onVoice,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  onVoice: (m: EventMessageDto) => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [voiceSending, setVoiceSending] = useState(false);
  const startedAt = useRef(0);
  const startPromise = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecordSecs(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [recording]);

  const begin = () => {
    startPromise.current = (async () => {
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) return false;
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        startedAt.current = Date.now();
        setRecordSecs(0);
        setRecording(true);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return true;
      } catch (err) {
        debugLog("api", "error", "event voice start failed", String(err));
        return false;
      }
    })();
  };

  const end = () => {
    const p = startPromise.current;
    startPromise.current = null;
    void (async () => {
      const started = await p;
      if (!started) return;
      setRecording(false);
      const durationMs = Date.now() - startedAt.current;
      try {
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        const uri = recorder.uri;
        if (!uri || durationMs < MIN_VOICE_MS) return;
        setVoiceSending(true);
        const msg = await uploadEventVoice(uri, durationMs);
        onVoice(msg);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        debugLog("api", "error", "event voice failed", String(err));
      } finally {
        setVoiceSending(false);
      }
    })();
  };

  const toggleVoice = () => {
    if (recording || startPromise.current) end();
    else begin();
  };

  if (recording) {
    return (
      <Pressable style={styles.recordingBar} onPress={end}>
        <View style={styles.recordingDot} />
        <Text style={styles.recordingText}>Recording · {formatDuration(recordSecs * 1000)}</Text>
        <Text style={styles.recordingHint}>tap to send</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.composer}>
      <TextInput
        style={styles.input}
        placeholder="Message the team…"
        placeholderTextColor="#54657c"
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={onSend}
        returnKeyType="send"
        multiline
      />
      {draft.trim().length > 0 ? (
        <Pressable style={[styles.sendBtn, sending && styles.sendBtnDisabled]} onPress={onSend} disabled={sending}>
          {sending ? <ActivityIndicator size="small" color="#04121f" /> : <Feather name="send" size={18} color="#04121f" />}
        </Pressable>
      ) : (
        <Pressable style={styles.micBtn} onPress={toggleVoice} disabled={voiceSending}>
          {voiceSending ? <ActivityIndicator size="small" color="#34d399" /> : <Feather name="mic" size={19} color="#34d399" />}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#020b18" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: "#f4f8ff", fontSize: 19, fontWeight: "900", letterSpacing: 0.2 },
  subtitle: { color: "#64748b", fontSize: 11.5, fontWeight: "700", marginTop: 1 },
  headerBadge: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "rgba(34,197,94,0.1)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 14, gap: 3 },
  emptyWrap: { alignItems: "center", paddingTop: 80, paddingHorizontal: 40, gap: 8 },
  emptyText: { color: "#7d8ea4", fontSize: 15, fontWeight: "800", marginTop: 4 },
  emptySub: { color: "#475569", fontSize: 12.5, textAlign: "center", lineHeight: 18 },

  dateSep: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 12, paddingHorizontal: 30 },
  dateLine: { flex: 1, height: 1, backgroundColor: "rgba(148,163,184,0.12)" },
  dateText: { color: "#5f7088", fontSize: 11, fontWeight: "800" },

  systemRow: { alignItems: "center", marginVertical: 4 },
  systemCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 11,
    maxWidth: "92%",
  },
  systemIcon: { width: 28, height: 28, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  systemLabel: { fontSize: 10.5, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" },
  systemText: { color: "#d6e2f0", fontSize: 13, fontWeight: "600", marginTop: 1 },
  systemTime: { color: "#5f7088", fontSize: 10, fontWeight: "700", alignSelf: "flex-start", marginTop: 2 },

  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: 7, marginVertical: 1.5 },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowOther: { justifyContent: "flex-start" },
  avatarSlot: { width: 28 },
  avatar: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 11, fontWeight: "900" },
  author: { color: "#7e93ac", fontSize: 11, fontWeight: "800", marginBottom: 3, marginLeft: 4 },
  bubble: { borderRadius: 17, paddingVertical: 8, paddingHorizontal: 12 },
  bubbleOther: { backgroundColor: "#142235", borderTopLeftRadius: 5 },
  bubbleMine: { backgroundColor: "#34d399", borderTopRightRadius: 5 },
  bubbleText: { color: "#e6eef9", fontSize: 14.5, lineHeight: 20 },
  bubbleTextMine: { color: "#04121f", fontWeight: "600" },
  bubbleTime: { color: "#5f7088", fontSize: 9.5, fontWeight: "700", alignSelf: "flex-end", marginTop: 3 },
  bubbleTimeMine: { color: "rgba(4,18,31,0.55)" },

  voiceRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 2 },
  voicePlay: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  waveform: { flexDirection: "row", alignItems: "center", gap: 2.5, height: 22 },
  waveBar: { width: 2.5, borderRadius: 2 },
  voiceDur: { fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  transcript: { color: "#aeb9c9", fontSize: 12, lineHeight: 16, fontStyle: "italic", marginTop: 6, maxWidth: 230 },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 9,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderColor: "rgba(148,163,184,0.1)",
    backgroundColor: "#060f1d",
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    backgroundColor: "#101d31",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    color: "#e8eef7",
    fontSize: 14.5,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: "#34d399", alignItems: "center", justifyContent: "center" },
  sendBtnDisabled: { opacity: 0.6 },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#101d31",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  recordingBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    margin: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.4)",
  },
  recordingDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: "#ef4444" },
  recordingText: { flex: 1, color: "#fecaca", fontSize: 13.5, fontWeight: "800" },
  recordingHint: { color: "#f87171", fontSize: 12, fontWeight: "800" },
});
