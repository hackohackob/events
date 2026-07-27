import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
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
import { useNotificationFocus } from "../notifications/notification-focus";
import { getSocket } from "../realtime/socket-client";
import { debugLog } from "../debug/debug-log";
import {
  listEventMessages,
  sendEventLocation,
  sendEventMessage,
  uploadEventPhoto,
  uploadEventVoice,
  type EventFeedType,
  type EventMessageDto,
  type PttMessageOrigin,
} from "./event-chat-api";

const FEED_META: Record<EventFeedType, { icon: keyof typeof Feather.glyphMap; color: string; label: string }> = {
  incident: { icon: "alert-triangle", color: "#f87171", label: "Incident" },
  response: { icon: "navigation", color: "#60a5fa", label: "Responding" },
  poi: { icon: "map-pin", color: "#34d399", label: "New point" },
};

/** Messages relayed in from a PTT network are badged with their source. */
const ORIGIN_META: Partial<Record<PttMessageOrigin, { color: string; label: string; icon: keyof typeof Feather.glyphMap }>> = {
  zello: { color: "#f59e0b", label: "Zello", icon: "radio" },
  radio: { color: "#38bdf8", label: "Radio", icon: "wifi" },
};

function originOf(msg: EventMessageDto) {
  return msg.origin && msg.origin !== "app" ? ORIGIN_META[msg.origin] : undefined;
}

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

export function EventChatScreen({ onClose, bottomInset = 0 }: { onClose: () => void; bottomInset?: number }) {
  const myId = useSessionStore((s) => s.userId);
  const [messages, setMessages] = useState<EventMessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const listRef = useRef<FlatList<Row>>(null);

  // The screen lives in an absolutely-positioned overlay, so KeyboardAvoidingView
  // can't shrink it. Track the keyboard height and lift the composer above it.
  // The overlay already sits `bottomInset` px above the screen bottom (the tab
  // bar), so only the part of the keyboard that overlaps the overlay matters.
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) =>
      setKbHeight(Math.max(0, (e.endCoordinates?.height ?? 0) - bottomInset)),
    );
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [bottomInset]);

  useEffect(() => {
    if (kbHeight > 0) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [kbHeight]);

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
    <View style={[styles.root, { paddingBottom: kbHeight }]}>
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

      <Composer
        draft={draft}
        setDraft={setDraft}
        onSend={send}
        sending={sending}
        onAttachment={(m) => setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))}
      />
    </View>
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
  // Incident / response / POI cards deep-link to their map marker: the focus
  // store switches to the map tab, frames the target and opens its sheet —
  // the same flow a tapped incident notification takes.
  const targetId =
    (msg.meta?.incidentId as string | undefined) ?? (msg.meta?.poiId as string | undefined);
  return (
    <View style={styles.systemRow}>
      <Pressable
        disabled={!targetId}
        onPress={() => {
          if (!targetId) return;
          void Haptics.selectionAsync();
          useNotificationFocus.getState().focusIncident(targetId);
        }}
        style={({ pressed }) => [
          styles.systemCard,
          { borderColor: `${meta.color}44`, backgroundColor: `${meta.color}12` },
          pressed && targetId ? { opacity: 0.7 } : null,
        ]}
      >
        <View style={[styles.systemIcon, { backgroundColor: `${meta.color}22`, borderColor: `${meta.color}55` }]}>
          <Feather name={meta.icon} size={14} color={meta.color} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.systemLabel, { color: meta.color }]}>{meta.label}</Text>
          <Text style={styles.systemText}>{msg.text}</Text>
        </View>
        <View style={styles.systemRight}>
          <Text style={styles.systemTime}>{formatTime(msg.createdAt)}</Text>
          {targetId ? <Feather name="chevron-right" size={14} color="#5f7088" /> : null}
        </View>
      </Pressable>
    </View>
  );
}

function ChatBubble({ row }: { row: Row }) {
  const { msg, mine, showHeader } = row;
  const name = msg.authorName || "Team";
  const origin = originOf(msg);

  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowOther]}>
      {!mine ? (
        <View style={styles.avatarSlot}>
          {showHeader ? (
            origin ? (
              <View style={[styles.avatar, { backgroundColor: `${origin.color}22`, borderWidth: 1, borderColor: `${origin.color}66` }]}>
                <Feather name={origin.icon} size={13} color={origin.color} />
              </View>
            ) : (
              <View style={[styles.avatar, { backgroundColor: avatarColor(name) }]}>
                <Text style={styles.avatarText}>{initials(name)}</Text>
              </View>
            )
          ) : null}
        </View>
      ) : null}
      <View style={{ maxWidth: "78%" }}>
        {showHeader && !mine ? (
          <View style={styles.authorRow}>
            <Text style={[styles.author, origin ? { color: origin.color } : null]}>{name}</Text>
            {origin ? (
              <View style={[styles.originTag, { backgroundColor: `${origin.color}1e` }]}>
                <Text style={[styles.originTagText, { color: origin.color }]}>{origin.label}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <View
          style={[
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleOther,
            origin && !mine ? { borderLeftWidth: 2, borderLeftColor: origin.color } : null,
          ]}
        >
          {msg.audioUrl ? (
            <VoiceContent msg={msg} mine={mine} />
          ) : msg.imageUrl ? (
            <PhotoContent msg={msg} mine={mine} />
          ) : msg.location ? (
            <LocationContent msg={msg} mine={mine} />
          ) : (
            <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{msg.text}</Text>
          )}
          <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>{formatTime(msg.createdAt)}</Text>
        </View>
      </View>
    </View>
  );
}

function PhotoContent({ msg, mine }: { msg: EventMessageDto; mine: boolean }) {
  const uri = resolveMediaUrl(msg.thumbnailUrl ?? msg.imageUrl);
  const full = resolveMediaUrl(msg.imageUrl);
  return (
    <Pressable
      onPress={() => {
        if (!full) return;
        void Haptics.selectionAsync();
        void Linking.openURL(full);
      }}
    >
      {uri ? <Image source={{ uri }} style={styles.photo} resizeMode="cover" /> : null}
      {msg.text ? (
        <Text style={[styles.bubbleText, mine && styles.bubbleTextMine, { marginTop: 6 }]}>{msg.text}</Text>
      ) : null}
    </Pressable>
  );
}

function LocationContent({ msg, mine }: { msg: EventMessageDto; mine: boolean }) {
  const loc = msg.location!;
  const label = loc.address ?? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
  return (
    <Pressable
      style={styles.locationRow}
      onPress={() => {
        void Haptics.selectionAsync();
        // Hand off to the OS maps app rather than embedding a second map here.
        const url = Platform.select({
          ios: `maps://?ll=${loc.lat},${loc.lng}&q=${encodeURIComponent(label)}`,
          default: `geo:${loc.lat},${loc.lng}?q=${loc.lat},${loc.lng}(${encodeURIComponent(label)})`,
        });
        void Linking.openURL(url!);
      }}
    >
      <View style={[styles.locationIcon, { backgroundColor: mine ? "rgba(4,18,31,0.15)" : "rgba(52,211,153,0.16)" }]}>
        <Feather name="map-pin" size={15} color={mine ? "#04121f" : "#34d399"} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.locationLabel, mine && { color: "#04121f" }]} numberOfLines={2}>
          {label}
        </Text>
        <Text style={[styles.locationSub, mine && { color: "rgba(4,18,31,0.6)" }]}>
          {msg.text || (loc.accuracyM ? `±${loc.accuracyM} m` : "Shared location")}
        </Text>
      </View>
    </Pressable>
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
  onAttachment,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  /** Voice note, photo or location that the server already stored. */
  onAttachment: (m: EventMessageDto) => void;
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
        onAttachment(msg);
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

  // ── Attachments ────────────────────────────────────────────────────────────
  const [attachOpen, setAttachOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);

  const attachPhoto = async (source: "camera" | "library") => {
    setAttachOpen(false);
    try {
      const perm =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
          : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, mediaTypes: ["images"] });
      const uri = result.canceled ? null : result.assets[0]?.uri;
      if (!uri) return;
      setAttaching(true);
      onAttachment(await uploadEventPhoto(uri, draft.trim() || undefined));
      setDraft("");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      debugLog("api", "error", "event photo failed", String(err));
    } finally {
      setAttaching(false);
    }
  };

  const attachLocation = async () => {
    setAttachOpen(false);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      setAttaching(true);
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      onAttachment(
        await sendEventLocation({
          lat: fix.coords.latitude,
          lng: fix.coords.longitude,
          accuracyM: fix.coords.accuracy ? Math.round(fix.coords.accuracy) : undefined,
          text: draft.trim() || undefined,
        }),
      );
      setDraft("");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      debugLog("api", "error", "event location failed", String(err));
    } finally {
      setAttaching(false);
    }
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
    <View>
      {attachOpen ? (
        <View style={styles.attachTray}>
          <AttachButton icon="camera" label="Camera" color="#60a5fa" onPress={() => void attachPhoto("camera")} />
          <AttachButton icon="image" label="Photo" color="#a78bfa" onPress={() => void attachPhoto("library")} />
          <AttachButton icon="map-pin" label="Location" color="#34d399" onPress={() => void attachLocation()} />
        </View>
      ) : null}

      <View style={styles.composer}>
        <Pressable
          style={[styles.attachBtn, attachOpen && styles.attachBtnOpen]}
          onPress={() => {
            void Haptics.selectionAsync();
            setAttachOpen((o) => !o);
          }}
          disabled={attaching}
        >
          {attaching ? (
            <ActivityIndicator size="small" color="#94a3b8" />
          ) : (
            <Feather name={attachOpen ? "x" : "plus"} size={19} color={attachOpen ? "#34d399" : "#94a3b8"} />
          )}
        </Pressable>

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
    </View>
  );
}

function AttachButton({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.attachItem, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={[styles.attachIcon, { backgroundColor: `${color}1c`, borderColor: `${color}55` }]}>
        <Feather name={icon} size={19} color={color} />
      </View>
      <Text style={styles.attachLabel}>{label}</Text>
    </Pressable>
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
  systemTime: { color: "#5f7088", fontSize: 10, fontWeight: "700" },
  systemRight: { alignItems: "flex-end", gap: 3, alignSelf: "flex-start", marginTop: 2 },

  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: 7, marginVertical: 1.5 },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowOther: { justifyContent: "flex-start" },
  avatarSlot: { width: 28 },
  avatar: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 11, fontWeight: "900" },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 3, marginLeft: 4 },
  author: { color: "#7e93ac", fontSize: 11, fontWeight: "800" },
  originTag: { paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 5 },
  originTagText: { fontSize: 8.5, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
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

  photo: { width: 216, height: 162, borderRadius: 12, backgroundColor: "#0b1626" },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 9, minWidth: 190, paddingVertical: 2 },
  locationIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  locationLabel: { color: "#e6eef9", fontSize: 13.5, fontWeight: "700" },
  locationSub: { color: "#7e93ac", fontSize: 11, fontWeight: "600", marginTop: 1 },

  attachTray: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  attachItem: { alignItems: "center", gap: 5, width: 66 },
  attachIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  attachLabel: { color: "#94a3b8", fontSize: 10.5, fontWeight: "800" },
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#101d31",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  attachBtnOpen: { borderColor: "rgba(52,211,153,0.45)", backgroundColor: "rgba(52,211,153,0.1)" },

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
