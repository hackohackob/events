import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
// Gesture-handler ScrollView: plain RN ScrollViews don't receive horizontal pan
// gestures inside a @gorhom/bottom-sheet — the sheet swallows them.
import { ScrollView } from "react-native-gesture-handler";
import { BottomSheetScrollView, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from "expo-audio";
import { getSocket } from "../realtime/socket-client";
import { resolveMediaUrl } from "../ui/api-client";
import {
  archiveIncident,
  assignIncidentResponder,
  closeIncident,
  listIncidentMessages,
  sendIncidentMessage,
  unassignIncidentResponder,
  type IncidentMessageDto,
} from "../ui/event-actions";
import { AssignDestinationBar } from "../map/AssignDestinationBar";
import { useMapStore, type MapMarker } from "../map/map-store";
import { useSessionStore } from "../security/session-store";
import { useRosterStore } from "../security/roster-store";
import { freshnessBucket, freshnessColor, freshnessLabel } from "../map/freshness";
import { uploadIncidentPhoto, uploadIncidentVoice } from "./incident-api";
import { debugLog } from "../debug/debug-log";
import { useIncidentReadsStore } from "./incident-reads-store";

const TYPE_META: Record<string, { label: string; icon: string }> = {
  medical: { label: "Medical", icon: "🏥" },
  cardiac: { label: "Cardiac", icon: "❤️" },
  trauma: { label: "Trauma", icon: "🩹" },
  fracture: { label: "Fracture", icon: "🦴" },
  unconscious: { label: "Unconscious", icon: "😵" },
  other: { label: "Other", icon: "⚠️" },
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  open: { label: "Open", color: "#f87171" },
  assigned: { label: "Assigned", color: "#fbbf24" },
  in_progress: { label: "On scene", color: "#fb923c" },
  resolved: { label: "Resolved", color: "#34d399" },
  closed: { label: "Closed", color: "#94a3b8" },
  archived: { label: "Archived", color: "#64748b" },
};

function typeMeta(type?: string) {
  return TYPE_META[type ?? ""] ?? { label: type ? type.charAt(0).toUpperCase() + type.slice(1) : "Incident", icon: "⚠️" };
}

function statusMeta(status?: string) {
  return STATUS_META[status ?? "open"] ?? STATUS_META.open;
}

function timeAgo(iso?: string): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return new Date(iso).toLocaleDateString();
}

function initials(label: string): string {
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

function formatVoiceDuration(ms?: number): string {
  const totalSecs = Math.max(1, Math.round((ms ?? 0) / 1000));
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/** Minimum recording length for a voice note — anything shorter is discarded. */
const MIN_VOICE_MS = 800;

interface Props {
  incident: MapMarker;
  distanceKm: number | null;
  markerById: Map<string, MapMarker>;
  onClose: () => void;
  /** Receives a fully-resolved (absolute) media URL. */
  onOpenPhoto: (url: string) => void;
}

/**
 * Full incident detail sheet: hero header, navigate action, report meta, notes,
 * photo gallery (anyone can append photos after the report), responder roster
 * with coordinator assign/unassign, live team chat, and the close/archive flow.
 * Rendered inside the map screen's marker BottomSheet.
 */
export function IncidentSheet({ incident, distanceKm, markerById, onClose, onOpenPhoto }: Props) {
  const myId = useSessionStore((s) => s.userId);
  const amCoordinator = useRosterStore((s) => s.amCoordinator);
  const rosterMedics = useRosterStore((s) => s.medics);

  const [messages, setMessages] = useState<IncidentMessageDto[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [showClose, setShowClose] = useState(false);
  const [vitals, setVitals] = useState("");
  const [treatment, setTreatment] = useState("");
  const [transport, setTransport] = useState("");
  const [closing, setClosing] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // ── Voice notes ───────────────────────────────────────────────────────────
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recordingUi, setRecordingUi] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [voiceSending, setVoiceSending] = useState(false);
  const recordStartPromise = React.useRef<Promise<boolean> | null>(null);
  const recordStartedAt = React.useRef(0);

  useEffect(() => {
    if (!recordingUi) return;
    const timer = setInterval(
      () => setRecordSecs(Math.floor((Date.now() - recordStartedAt.current) / 1000)),
      250,
    );
    return () => clearInterval(timer);
  }, [recordingUi]);

  const beginVoiceNote = () => {
    recordStartPromise.current = (async () => {
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) return false;
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        recordStartedAt.current = Date.now();
        setRecordSecs(0);
        setRecordingUi(true);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return true;
      } catch (err) {
        debugLog("api", "error", "voice record start failed", String(err));
        return false;
      }
    })();
  };

  const endVoiceNote = () => {
    const startPromise = recordStartPromise.current;
    recordStartPromise.current = null;
    void (async () => {
      const started = await startPromise;
      if (!started) return;
      setRecordingUi(false);
      const durationMs = Date.now() - recordStartedAt.current;
      try {
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        const uri = recorder.uri;
        if (!uri || durationMs < MIN_VOICE_MS) return; // fumbled tap — discard
        setVoiceSending(true);
        const message = await uploadIncidentVoice(incident.id, uri, durationMs);
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        debugLog("api", "error", "voice note failed", String(err));
        Alert.alert("Voice note failed", "The recording could not be sent. Please try again.");
      } finally {
        setVoiceSending(false);
      }
    })();
  };

  // Tap-to-toggle (NOT push-to-talk): a tap starts recording, the next tap — on
  // the mic OR the red recording bar — stops and sends. Using a plain `onPress`
  // (not press-in/press-out) keeps the touch a quick tap, so the surrounding
  // bottom sheet's pan gesture never grabs it and collapses the panel.
  const toggleVoiceNote = () => {
    if (recordingUi || recordStartPromise.current) {
      endVoiceNote();
    } else {
      beginVoiceNote();
    }
  };

  // Shared playback for voice bubbles — tap a bubble to play, tap again to stop.
  const voicePlayer = useAudioPlayer();
  const voiceStatus = useAudioPlayerStatus(voicePlayer);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);

  useEffect(() => {
    if (voiceStatus.didJustFinish) setPlayingMessageId(null);
  }, [voiceStatus.didJustFinish]);

  const toggleVoicePlayback = (messageId: string, audioUrl: string) => {
    if (playingMessageId === messageId) {
      voicePlayer.pause();
      setPlayingMessageId(null);
      return;
    }
    const resolved = resolveMediaUrl(audioUrl);
    if (!resolved) return;
    voicePlayer.replace({ uri: resolved });
    voicePlayer.play();
    setPlayingMessageId(messageId);
  };

  const type = typeMeta(incident.incidentType);
  const status = statusMeta(incident.status);
  const isClosed = incident.status === "resolved" || incident.status === "closed" || incident.status === "archived";
  const reportedAgo = timeAgo(incident.createdAt);
  const responders = incident.respondingParamedicIds ?? [];

  const photos = useMemo(() => {
    const list = [...(incident.photoUrls ?? [])];
    if (incident.photoUrl && !list.includes(incident.photoUrl)) list.unshift(incident.photoUrl);
    return list;
  }, [incident.photoUrl, incident.photoUrls]);

  // ── Chat: load history + live socket updates ───────────────────────────────
  useEffect(() => {
    let active = true;
    // Opening the thread clears the unread indicator for this incident.
    useIncidentReadsStore.getState().markRead(incident.id);
    void listIncidentMessages(incident.id)
      .then((list) => active && setMessages(list))
      .catch((err) => debugLog("api", "error", "load messages failed", String(err)));

    const socket = getSocket();
    const onMessage = (msg: IncidentMessageDto) => {
      if (msg.incidentId !== incident.id) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      // Sheet is open → keep it marked read as new messages land.
      useIncidentReadsStore.getState().markRead(incident.id);
    };
    socket.on("incident.message", onMessage);
    return () => {
      active = false;
      socket.off("incident.message", onMessage);
    };
  }, [incident.id]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const msg = await sendIncidentMessage(incident.id, text);
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      setDraft("");
    } catch (err) {
      debugLog("api", "error", "send message failed", String(err));
    } finally {
      setSending(false);
    }
  };

  // ── Photos ────────────────────────────────────────────────────────────────
  const pickAndUpload = async (mode: "camera" | "library") => {
    try {
      const permission =
        mode === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;

      const result =
        mode === "camera"
          ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
          : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, mediaTypes: ["images"] });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      setUploadingPhoto(true);
      const url = await uploadIncidentPhoto(incident.id, result.assets[0].uri);
      // Optimistic: show the new photo immediately; the server also broadcasts
      // incident.updated so every other client refreshes too.
      const markers = useMapStore.getState().markers;
      useMapStore.getState().setMarkers(
        markers.map((m) =>
          m.id === incident.id && m.type === "incident"
            ? {
                ...m,
                photoUrl: m.photoUrl ?? url,
                photoUrls: [...(m.photoUrls ?? []), url].filter((u, i, a) => a.indexOf(u) === i),
              }
            : m,
        ),
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      debugLog("api", "error", "photo upload failed", String(err));
      Alert.alert("Upload failed", "The photo could not be uploaded. Please try again.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const addPhoto = () => {
    Alert.alert("Add photo", "Attach a photo to this incident — the whole team will see it.", [
      { text: "Take photo", onPress: () => void pickAndUpload("camera") },
      { text: "Choose from library", onPress: () => void pickAndUpload("library") },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  // ── Responders ────────────────────────────────────────────────────────────
  const responderName = (id: string) =>
    markerById.get(id)?.name ?? markerById.get(id)?.label ?? rosterMedics.find((m) => m.id === id)?.name ?? id;

  const updateRespondersLocally = (next: string[]) => {
    const markers = useMapStore.getState().markers;
    useMapStore.getState().setMarkers(
      markers.map((m) => (m.id === incident.id && m.type === "incident" ? { ...m, respondingParamedicIds: next } : m)),
    );
  };

  const confirmUnassign = (medicId: string) => {
    Alert.alert(
      "Unassign medic?",
      `Remove ${responderName(medicId)} from this incident? They will be notified to stand down.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unassign",
          style: "destructive",
          onPress: () => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            updateRespondersLocally(responders.filter((id) => id !== medicId));
            void unassignIncidentResponder(incident.id, medicId).catch((err) => {
              debugLog("api", "error", "unassign failed", String(err));
              updateRespondersLocally(responders); // roll back
            });
          },
        },
      ],
    );
  };

  const assignableMedics = useMemo(
    () =>
      rosterMedics
        .filter((m) => !responders.includes(m.id))
        .map((m) => {
          const live = markerById.get(m.id);
          return { id: m.id, name: m.name, vehicle: m.vehicle ?? live?.vehicle, lastSeenAt: live?.lastSeenAt };
        }),
    [rosterMedics, responders, markerById],
  );

  const assignMedic = async (medicId: string) => {
    if (assigningId) return;
    setAssigningId(medicId);
    try {
      await assignIncidentResponder(incident.id, medicId);
      updateRespondersLocally([...responders, medicId]);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAssignOpen(false);
    } catch (err) {
      debugLog("api", "error", "assign medic failed", String(err));
      Alert.alert("Assign failed", "Could not assign this medic. Please try again.");
    } finally {
      setAssigningId(null);
    }
  };

  // ── Close / archive ───────────────────────────────────────────────────────
  const submitClose = async () => {
    setClosing(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await closeIncident(incident.id, {
        vitals: vitals.trim() || undefined,
        treatment: treatment.trim() || undefined,
        transport: transport.trim() || undefined,
      });
      onClose();
    } catch (err) {
      debugLog("api", "error", "close incident failed", String(err));
    } finally {
      setClosing(false);
    }
  };

  const archive = () => {
    Alert.alert("Archive incident?", "It will disappear from the live map for everyone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        style: "destructive",
        onPress: () => {
          setArchiving(true);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          void archiveIncident(incident.id)
            .then(() => onClose())
            .catch((err) => {
              debugLog("api", "error", "archive incident failed", String(err));
              setArchiving(false);
            });
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      {/* ── Hero header ── */}
      <View style={styles.header}>
        <View style={[styles.heroBadge, { borderColor: `${status.color}55` }]}>
          <Text style={styles.heroIcon}>{type.icon}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{incident.name ?? incident.label}</Text>
          <View style={styles.headerChips}>
            <View style={[styles.statusPill, { backgroundColor: `${status.color}22`, borderColor: `${status.color}66` }]}>
              <View style={[styles.statusDot, { backgroundColor: status.color }]} />
              <Text style={[styles.statusPillText, { color: status.color }]}>{status.label}</Text>
            </View>
            <Text style={styles.headerMeta} numberOfLines={1}>
              {type.label}
              {distanceKm != null ? ` · ${distanceKm.toFixed(1)} km away` : ""}
            </Text>
          </View>
        </View>
        {/* Tap to start, tap again (or tap the red bar) to send — straight into chat. */}
        <Pressable
          style={[styles.micBtn, recordingUi && styles.micBtnActive]}
          onPress={toggleVoiceNote}
          disabled={voiceSending}
          hitSlop={6}
        >
          {voiceSending ? (
            <ActivityIndicator size="small" color="#34d399" />
          ) : (
            <Feather name="mic" size={17} color={recordingUi ? "#04121f" : "#34d399"} />
          )}
        </Pressable>
        <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
          <Feather name="x" size={18} color="#94a3b8" />
        </Pressable>
      </View>

      {recordingUi ? (
        <Pressable style={styles.recordingBar} onPress={endVoiceNote}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>
            Recording voice note · {formatVoiceDuration(recordSecs * 1000)}
          </Text>
          <Text style={styles.recordingHint}>tap to send</Text>
        </Pressable>
      ) : null}

      <BottomSheetScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        {/* ── Primary action: navigate / respond ── */}
        {!isClosed ? (
          <AssignDestinationBar
            destination={{ lat: incident.lat, lng: incident.lng, label: incident.name ?? incident.label }}
            incidentId={incident.id}
          />
        ) : null}

        {/* ── Report meta ── */}
        <View style={styles.metaRow}>
          <View style={styles.metaCell}>
            <Feather name="clock" size={13} color="#64748b" />
            <Text style={styles.metaValue} numberOfLines={1}>{reportedAgo ?? "Unknown"}</Text>
            <Text style={styles.metaLabel}>REPORTED</Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaCell}>
            <Feather name="user" size={13} color="#64748b" />
            <Text style={styles.metaValue} numberOfLines={1}>{incident.reportedBy ?? "Unknown"}</Text>
            <Text style={styles.metaLabel}>BY</Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaCell}>
            <Feather name="users" size={13} color="#64748b" />
            <Text style={styles.metaValue}>{responders.length}</Text>
            <Text style={styles.metaLabel}>RESPONDING</Text>
          </View>
        </View>

        {/* ── Notes ── */}
        <View style={styles.section}>
          <Text style={styles.sectionKicker}>NOTES</Text>
          <View style={styles.card}>
            <Text style={incident.description ? styles.notesText : styles.emptyText}>
              {incident.description || "No notes yet."}
            </Text>
          </View>
        </View>

        {/* ── Photos ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionKicker}>PHOTOS{photos.length ? ` (${photos.length})` : ""}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>
            {photos.map((photo) => {
              const resolved = resolveMediaUrl(photo);
              return (
                <Pressable key={photo} onPress={() => resolved && onOpenPhoto(resolved)} style={styles.thumbWrap}>
                  <Image source={{ uri: resolved }} style={styles.thumb} />
                </Pressable>
              );
            })}
            <Pressable style={styles.addThumb} onPress={addPhoto} disabled={uploadingPhoto}>
              {uploadingPhoto ? (
                <ActivityIndicator size="small" color="#34d399" />
              ) : (
                <>
                  <Feather name="camera" size={20} color="#34d399" />
                  <Text style={styles.addThumbText}>Add</Text>
                </>
              )}
            </Pressable>
          </ScrollView>
        </View>

        {/* ── Responders ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionKicker}>RESPONDERS</Text>
            {amCoordinator && !isClosed ? (
              <Pressable style={styles.assignBtn} onPress={() => setAssignOpen(true)}>
                <Feather name="plus" size={13} color="#34d399" />
                <Text style={styles.assignBtnText}>Assign medic</Text>
              </Pressable>
            ) : null}
          </View>
          {responders.length > 0 ? (
            <View style={styles.card}>
              {responders.map((medicId, index) => {
                const live = markerById.get(medicId);
                const ageMs = live?.lastSeenAt ? Date.now() - new Date(live.lastSeenAt).getTime() : undefined;
                return (
                  <View key={medicId} style={[styles.responderRow, index > 0 && styles.responderRowBorder]}>
                    <View style={styles.responderAvatar}>
                      <Text style={styles.responderAvatarText}>{initials(responderName(medicId))}</Text>
                      <View style={[styles.responderFreshDot, { backgroundColor: freshnessColor(ageMs) }]} />
                    </View>
                    <View style={styles.responderText}>
                      <Text style={styles.responderName} numberOfLines={1}>
                        {responderName(medicId)}
                        {medicId === myId ? "  (you)" : ""}
                      </Text>
                      <Text style={styles.responderMeta} numberOfLines={1}>
                        {live?.vehicle ?? "Medical unit"}
                        {ageMs !== undefined && freshnessBucket(ageMs) !== "fresh" ? ` · ${freshnessLabel(ageMs)}` : ""}
                      </Text>
                    </View>
                    {amCoordinator && !isClosed ? (
                      <Pressable style={styles.unassignBtn} onPress={() => confirmUnassign(medicId)} hitSlop={6}>
                        <Feather name="user-minus" size={14} color="#f87171" />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.emptyText}>No responders yet.</Text>
            </View>
          )}
        </View>

        {/* ── Team chat ── */}
        <View style={styles.section}>
          <Text style={styles.sectionKicker}>TEAM CHAT{messages.length ? ` (${messages.length})` : ""}</Text>
          <View style={styles.card}>
            {messages.length === 0 ? (
              <Text style={styles.emptyText}>No messages yet. Coordinate with the team.</Text>
            ) : (
              <View style={styles.chatList}>
                {messages.map((m) => {
                  // System log entries (reported / dispatched / arrived / …)
                  // render as centered timeline markers, not chat bubbles.
                  if (m.authorId === "system") {
                    return (
                      <View key={m.id} style={styles.logRow}>
                        <View style={styles.logLine} />
                        <Text style={styles.logText} numberOfLines={2}>
                          {m.text}
                          {"  "}
                          <Text style={styles.logTime}>
                            {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </Text>
                        </Text>
                        <View style={styles.logLine} />
                      </View>
                    );
                  }
                  const mine = m.authorId === myId;
                  const playing = playingMessageId === m.id;
                  return (
                    <View key={m.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                      {!mine ? <Text style={styles.bubbleAuthor}>{m.authorName}</Text> : null}
                      {m.audioUrl ? (
                        <>
                          <Pressable style={styles.voiceRow} onPress={() => toggleVoicePlayback(m.id, m.audioUrl!)}>
                            <View style={[styles.voicePlayBtn, playing && styles.voicePlayBtnActive]}>
                              <Feather name={playing ? "pause" : "play"} size={13} color="#04121f" />
                            </View>
                            <View style={styles.voiceWave}>
                              {[7, 12, 9, 14, 8, 12, 6, 10, 13, 8].map((h, i) => (
                                <View key={i} style={[styles.voiceWaveBar, { height: h }, playing && styles.voiceWaveBarActive]} />
                              ))}
                            </View>
                            <Text style={styles.voiceDuration}>{formatVoiceDuration(m.audioDurationMs)}</Text>
                          </Pressable>
                          {m.transcript ? (
                            <Text style={styles.voiceTranscript}>
                              <Feather name="file-text" size={10} color="#64748b" /> {m.transcript}
                            </Text>
                          ) : null}
                        </>
                      ) : (
                        <Text style={styles.bubbleText}>{m.text}</Text>
                      )}
                      <Text style={styles.bubbleTime}>
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    </View>
                  );
                })}
              </View>
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
              <Pressable
                style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
                onPress={send}
                disabled={!draft.trim() || sending}
              >
                {sending ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="send" size={16} color="#fff" />}
              </Pressable>
            </View>
          </View>
        </View>

        {/* ── Wrap-up actions ── */}
        {!isClosed ? (
          <View style={styles.section}>
            <Text style={styles.sectionKicker}>WRAP UP</Text>
            {!showClose ? (
              <Pressable style={styles.closeIncidentBtn} onPress={() => setShowClose(true)}>
                <Feather name="check-circle" size={16} color="#04121f" />
                <Text style={styles.closeIncidentText}>Close with handover</Text>
              </Pressable>
            ) : (
              <View style={[styles.card, styles.closeForm]}>
                <Text style={styles.formLabel}>CASUALTY HANDOVER</Text>
                <BottomSheetTextInput style={styles.input} placeholder="Vitals — BP, HR, SpO₂…" placeholderTextColor="#475569" value={vitals} onChangeText={setVitals} />
                <BottomSheetTextInput style={styles.input} placeholder="Treatment given" placeholderTextColor="#475569" value={treatment} onChangeText={setTreatment} />
                <BottomSheetTextInput style={styles.input} placeholder="Transport — self-care / ambulance…" placeholderTextColor="#475569" value={transport} onChangeText={setTransport} />
                <View style={styles.closeFormBtns}>
                  <Pressable style={styles.confirmCloseBtn} onPress={submitClose} disabled={closing}>
                    <Text style={styles.confirmCloseText}>{closing ? "Closing…" : "Close incident"}</Text>
                  </Pressable>
                  <Pressable style={styles.cancelBtn} onPress={() => setShowClose(false)}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            )}
            <Pressable style={styles.archiveBtn} onPress={archive} disabled={archiving}>
              <Feather name="archive" size={14} color="#94a3b8" />
              <Text style={styles.archiveText}>{archiving ? "Archiving…" : "Archive incident"}</Text>
            </Pressable>
          </View>
        ) : null}
      </BottomSheetScrollView>

      {/* ── Assign-medic picker (coordinator) ── */}
      <Modal visible={assignOpen} transparent animationType="fade" onRequestClose={() => setAssignOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAssignOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Assign a medic</Text>
            <Text style={styles.modalSubtitle}>They'll be alerted and marked as responding.</Text>
            <ScrollView style={styles.modalList} showsVerticalScrollIndicator={false}>
              {assignableMedics.length === 0 ? (
                <Text style={styles.emptyText}>Everyone is already assigned.</Text>
              ) : (
                assignableMedics.map((medic) => {
                  const ageMs = medic.lastSeenAt ? Date.now() - new Date(medic.lastSeenAt).getTime() : undefined;
                  return (
                    <Pressable key={medic.id} style={styles.modalRow} onPress={() => void assignMedic(medic.id)}>
                      <View style={styles.responderAvatar}>
                        <Text style={styles.responderAvatarText}>{initials(medic.name)}</Text>
                        <View style={[styles.responderFreshDot, { backgroundColor: freshnessColor(ageMs) }]} />
                      </View>
                      <View style={styles.responderText}>
                        <Text style={styles.responderName} numberOfLines={1}>{medic.name}</Text>
                        <Text style={styles.responderMeta} numberOfLines={1}>
                          {medic.vehicle ?? "Medical unit"}
                          {ageMs !== undefined ? ` · ${freshnessLabel(ageMs)}` : " · offline"}
                        </Text>
                      </View>
                      {assigningId === medic.id ? (
                        <ActivityIndicator size="small" color="#34d399" />
                      ) : (
                        <Feather name="chevron-right" size={16} color="#475569" />
                      )}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <Pressable style={styles.modalCancel} onPress={() => setAssignOpen(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingBottom: 12 },
  heroBadge: {
    width: 50,
    height: 50,
    borderRadius: 17,
    borderWidth: 1.5,
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroIcon: { fontSize: 24 },
  headerText: { flex: 1, minWidth: 0, gap: 5 },
  title: { color: "#f4f8ff", fontSize: 19, fontWeight: "900", letterSpacing: 0.2 },
  headerChips: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.3 },
  headerMeta: { color: "#8da3bd", fontSize: 12, fontWeight: "700", flexShrink: 1 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  micBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(34,197,94,0.1)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  micBtnActive: { backgroundColor: "#34d399", borderColor: "#34d399" },
  recordingBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 18,
    marginBottom: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.4)",
  },
  recordingDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#ef4444" },
  recordingText: { flex: 1, color: "#fecaca", fontSize: 12.5, fontWeight: "800" },
  recordingHint: { color: "#f87171", fontSize: 11, fontWeight: "700" },

  body: { flex: 1 },
  // Generous bottom inset: the sheet's lower edge sits behind the bottom tab
  // bar at the 42% snap, so without it the archive button gets clipped.
  bodyContent: { paddingHorizontal: 18, paddingBottom: 120, gap: 16 },

  // Meta strip
  metaRow: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.1)",
    paddingVertical: 10,
  },
  metaCell: { flex: 1, alignItems: "center", gap: 3, paddingHorizontal: 6 },
  metaDivider: { width: 1, backgroundColor: "rgba(148,163,184,0.12)", marginVertical: 4 },
  metaValue: { color: "#e8eef7", fontSize: 12.5, fontWeight: "800" },
  metaLabel: { color: "#64748b", fontSize: 8.5, fontWeight: "900", letterSpacing: 1 },

  // Sections
  section: { gap: 8 },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionKicker: { color: "#64748b", fontSize: 10, fontWeight: "900", letterSpacing: 1.3 },
  card: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.1)",
    padding: 12,
  },
  notesText: { color: "#d4deeb", fontSize: 13.5, lineHeight: 19 },
  emptyText: { color: "#475569", fontSize: 12.5, textAlign: "center", paddingVertical: 6 },

  // Gallery
  gallery: { gap: 9, paddingVertical: 2 },
  thumbWrap: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  thumb: { width: 96, height: 96, backgroundColor: "rgba(255,255,255,0.05)" },
  addThumb: {
    width: 96,
    height: 96,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "rgba(52,211,153,0.5)",
    backgroundColor: "rgba(34,197,94,0.06)",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  addThumbText: { color: "#34d399", fontSize: 11, fontWeight: "900" },

  // Responders
  assignBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.45)",
    backgroundColor: "rgba(34,197,94,0.1)",
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  assignBtnText: { color: "#34d399", fontSize: 11.5, fontWeight: "900" },
  responderRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 8 },
  responderRowBorder: { borderTopWidth: 1, borderTopColor: "rgba(148,163,184,0.09)" },
  responderAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(59,130,246,0.16)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  responderAvatarText: { color: "#bfdbfe", fontSize: 12.5, fontWeight: "900" },
  responderFreshDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#0a1322",
  },
  responderText: { flex: 1, minWidth: 0 },
  responderName: { color: "#e8eef7", fontSize: 13.5, fontWeight: "800" },
  responderMeta: { color: "#64748b", fontSize: 11.5, fontWeight: "600", marginTop: 1 },
  unassignBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(239,68,68,0.1)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Chat
  chatList: { gap: 7, marginBottom: 10 },
  logRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 },
  logLine: { flex: 1, height: 1, backgroundColor: "rgba(148,163,184,0.14)" },
  logText: { color: "#7d8ea4", fontSize: 11, fontWeight: "700", textAlign: "center", maxWidth: "78%" },
  logTime: { color: "#48586c", fontSize: 10, fontWeight: "700" },
  bubble: { maxWidth: "85%", borderRadius: 13, paddingVertical: 7, paddingHorizontal: 11 },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: "rgba(34,197,94,0.16)", borderTopRightRadius: 4 },
  bubbleOther: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.05)", borderTopLeftRadius: 4 },
  bubbleAuthor: { color: "#93c5fd", fontSize: 10.5, fontWeight: "900", marginBottom: 2 },
  bubbleText: { color: "#dbe5f1", fontSize: 13, lineHeight: 18 },
  bubbleTime: { color: "#5b6b80", fontSize: 9.5, fontWeight: "700", marginTop: 3, alignSelf: "flex-end" },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 2, minWidth: 170 },
  voicePlayBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#34d399",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 1,
  },
  voicePlayBtnActive: { backgroundColor: "#fbbf24", paddingLeft: 0 },
  voiceWave: { flex: 1, flexDirection: "row", alignItems: "center", gap: 2.5 },
  voiceWaveBar: { width: 3, borderRadius: 2, backgroundColor: "rgba(148,163,184,0.55)" },
  voiceWaveBarActive: { backgroundColor: "#34d399" },
  voiceDuration: { color: "#9fb3cc", fontSize: 11, fontWeight: "800" },
  voiceTranscript: { color: "#aeb9c9", fontSize: 12, lineHeight: 16, fontStyle: "italic", marginTop: 6, maxWidth: 230 },
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
    paddingVertical: 9,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center" },
  sendBtnDisabled: { opacity: 0.45 },

  // Wrap up
  closeIncidentBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#34d399",
    borderRadius: 14,
    paddingVertical: 13,
  },
  closeIncidentText: { color: "#04121f", fontSize: 14.5, fontWeight: "900" },
  closeForm: { gap: 8 },
  formLabel: { color: "#64748b", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
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
  confirmCloseBtn: { flex: 1, backgroundColor: "#16a34a", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  confirmCloseText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  cancelBtn: { paddingHorizontal: 16, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center" },
  cancelText: { color: "#64748b", fontSize: 13, fontWeight: "700" },
  archiveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 11,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  archiveText: { color: "#94a3b8", fontSize: 13, fontWeight: "800" },

  // Assign modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,15,0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },
  modalCard: {
    alignSelf: "stretch",
    maxHeight: "70%",
    backgroundColor: "rgba(10,17,30,0.99)",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    padding: 16,
  },
  modalTitle: { color: "#f4f8ff", fontSize: 17, fontWeight: "900" },
  modalSubtitle: { color: "#64748b", fontSize: 12, fontWeight: "600", marginTop: 2, marginBottom: 10 },
  modalList: { flexGrow: 0 },
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: "rgba(148,163,184,0.08)",
  },
  modalCancel: { marginTop: 12, alignItems: "center", paddingVertical: 10, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.05)" },
  modalCancelText: { color: "#94a3b8", fontSize: 13.5, fontWeight: "800" },
});
