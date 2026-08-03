import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
// Gesture-handler ScrollView: plain RN ScrollViews don't receive horizontal pan
// gestures inside a @gorhom/bottom-sheet — the sheet swallows them.
import { ScrollView } from "react-native-gesture-handler";
import { BottomSheetScrollView, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
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
import { apiFetch, resolveMediaUrl } from "../ui/api-client";
import { useNavStore } from "../navigation/nav-store";
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
import { useLocationStatus } from "../debug/location-status";
import { uploadIncidentPhoto, uploadIncidentVoice } from "./incident-api";
import { debugLog } from "../debug/debug-log";
import { TranscriptText } from "../ui/TranscriptText";
import { useIncidentReadsStore } from "./incident-reads-store";
import { ClosestMedicsPanel } from "./ClosestMedicsPanel";
import { fetchClosestMedics, type ClosestMedic } from "./closest-medics-api";

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

/** Derive the reporter's role from their user id. Runners (from the participant
 *  PWA) have `runner_*` ids; everyone else reporting today is a medic.
 *  Organizer is reserved for a later role and isn't detected yet. */
function reporterRole(createdBy?: string): string {
  if (createdBy?.startsWith("runner_")) return "Participant";
  return "Medic";
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
  /** Coordinator-only: arm tap-the-map incident relocation (parent handles the flow). */
  onMoveLocation?: () => void;
  /** Show (or clear with null) the numbered asphalt exit pins on the map. */
  onAsphaltPins?: (pins: AsphaltPoint[] | null) => void;
  /** Select an exit point: draws its path/direct line + opens the preview card
   *  outside the drawer. Null clears the selection. */
  onSelectAsphaltPoint?: (point: AsphaltPoint | null) => void;
  /** Show (or clear with null) the colour-coded closest-medic routes on the map. */
  onClosestMedics?: (medics: ClosestMedic[] | null) => void;
  /** Emphasise one medic's route; null returns every route to equal weight. */
  onSelectClosestMedic?: (medic: ClosestMedic | null) => void;
}

/** Drawable walk path from the incident to an exit point. */
export interface AsphaltPath {
  geometry: Array<[number, number]>;
  elevations?: number[];
  ascentMeters?: number;
  descentMeters?: number;
  /**
   * Index into `geometry` where the routed network begins. Vertex 0 is the
   * incident itself, so anything before this is the off-path carry and is drawn
   * dashed rather than as a mapped way.
   */
  routeStartIndex?: number;
}

/** How much the backend trusts that the point really is asphalt. */
export type PavedConfidence = "confirmed" | "likely" | "unknown";

/** One measured leg (foot or bike), including the off-path carry at the start. */
export interface AsphaltLeg {
  distanceMeters: number;
  durationMs: number;
}

/** One paved-road access ("exit") point from /routing/closest-asphalt. */
export interface AsphaltPoint {
  index: number;
  lat: number;
  lng: number;
  roadHint?: string;
  surfaceHint?: string;
  confidence?: PavedConfidence;
  /** Set on the single recommended point — drawn green everywhere. */
  best?: boolean;
  incident: {
    distanceMeters: number;
    durationMs?: number;
    /** Straight-line metres from the incident to where the route begins. */
    offPathMeters?: number;
    offPathSignificant?: boolean;
    /** Reported separately, never blended — the two profiles route differently. */
    foot?: AsphaltLeg;
    bike?: AsphaltLeg;
    direct: boolean;
    noRoad?: boolean;
  };
  fromMe?: { distanceMeters: number; durationMs: number };
  /** Present for routed points; direct ones are drawn as a straight line. */
  path?: AsphaltPath;
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

export function formatMinutes(ms: number): string {
  return `${Math.max(1, Math.round(ms / 60000))} min`;
}

/** Accent per exit point: green = recommended, indigo = routed, amber = no route. */
export const EXIT_BEST_COLOR = "#22c55e";
export const EXIT_ROUTED_COLOR = "#818cf8";
export const EXIT_DIRECT_COLOR = "#f59e0b";

export function exitColor(point: AsphaltPoint): string {
  if (point.incident.direct) return EXIT_DIRECT_COLOR;
  return point.best ? EXIT_BEST_COLOR : EXIT_ROUTED_COLOR;
}

/** Short human note about how trustworthy the surface tagging is. */
export function surfaceNote(point: AsphaltPoint): string | null {
  if (point.confidence === "confirmed") {
    return point.surfaceHint ? point.surfaceHint.replace(/_/g, " ") : "asphalt";
  }
  if (point.confidence === "likely") return "sealed (typical for this road class)";
  if (point.confidence === "unknown") return "surface unverified";
  return null;
}

/** "Exit 2 · residential" — shared by the nav destination label and the POI name. */
export function exitLabel(point: AsphaltPoint): string {
  return `Exit ${point.index}${point.roadHint ? ` · ${point.roadHint.replace(/_/g, " ")}` : ""}`;
}

/**
 * Full incident detail sheet: hero header, navigate action, report meta, notes,
 * photo gallery (anyone can append photos after the report), responder roster
 * with coordinator assign/unassign, live team chat, and the close/archive flow.
 * Rendered inside the map screen's marker BottomSheet.
 */
export function IncidentSheet({ incident, distanceKm, markerById, onClose, onOpenPhoto, onMoveLocation, onAsphaltPins, onSelectAsphaltPoint, onClosestMedics, onSelectClosestMedic }: Props) {
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

  // ── Closest asphalt (in-drawer "exit points" view) ────────────────────────
  const [asphaltPoints, setAsphaltPoints] = useState<AsphaltPoint[] | null>(null);
  /** How far the expanding search had to reach — shown so the numbers have context. */
  const [asphaltRadius, setAsphaltRadius] = useState<number | null>(null);
  const [asphaltLoading, setAsphaltLoading] = useState(false);
  const [asphaltView, setAsphaltView] = useState(false);

  const [selectedExit, setSelectedExit] = useState<number | null>(null);

  // ── Closest medic (in-drawer dispatch view) ───────────────────────────────
  const [closestMedics, setClosestMedics] = useState<ClosestMedic[]>([]);
  const [closestUnlocated, setClosestUnlocated] = useState(0);
  const [closestLoading, setClosestLoading] = useState(false);
  const [closestView, setClosestView] = useState(false);
  const [selectedMedicId, setSelectedMedicId] = useState<string | null>(null);
  const [assigningClosestId, setAssigningClosestId] = useState<string | null>(null);

  // Never leave orphaned exit pins / medic routes on the map when this sheet
  // goes away.
  useEffect(() => {
    return () => {
      onAsphaltPins?.(null);
      onSelectAsphaltPoint?.(null);
      onClosestMedics?.(null);
      onSelectClosestMedic?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openAsphaltView = (points: AsphaltPoint[]) => {
    setAsphaltView(true);
    onAsphaltPins?.(points);
  };

  const closeAsphaltView = () => {
    setAsphaltView(false);
    setSelectedExit(null);
    onSelectAsphaltPoint?.(null);
    onAsphaltPins?.(null);
  };

  /** Tap a card: select it (draw path + open the preview card), tap again to clear. */
  const toggleExit = (point: AsphaltPoint) => {
    void Haptics.selectionAsync();
    if (selectedExit === point.index) {
      setSelectedExit(null);
      onSelectAsphaltPoint?.(null);
      return;
    }
    setSelectedExit(point.index);
    onSelectAsphaltPoint?.(point);
  };

  const loadClosestAsphalt = async () => {
    if (asphaltLoading) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (asphaltPoints) {
      openAsphaltView(asphaltPoints);
      return;
    }
    setAsphaltLoading(true);
    try {
      const myFix = useLocationStatus.getState().lastFix;
      const res = await apiFetch<{ points: AsphaltPoint[]; searchRadiusMeters?: number }>("/routing/closest-asphalt", {
        method: "POST",
        body: JSON.stringify({
          lat: incident.lat,
          lng: incident.lng,
          from: myFix ? { lat: myFix.lat, lng: myFix.lng } : undefined,
        }),
      });
      setAsphaltPoints(res.points);
      setAsphaltRadius(res.searchRadiusMeters ?? null);
      openAsphaltView(res.points);
    } catch (err) {
      debugLog("api", "error", "closest asphalt failed", String(err));
      Alert.alert("No asphalt found", "Couldn't find a reachable paved road around this incident.");
    } finally {
      setAsphaltLoading(false);
    }
  };

  const closeClosestView = () => {
    setClosestView(false);
    setSelectedMedicId(null);
    onSelectClosestMedic?.(null);
    onClosestMedics?.(null);
  };

  /**
   * Always re-routes rather than reusing a cached answer: medics move, and a
   * stale "4 min" is worse than a two-second wait. The view opens immediately
   * with a spinner so the map can already reframe.
   */
  const loadClosestMedics = async () => {
    if (closestLoading) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setClosestView(true);
    setClosestLoading(true);
    // Announce the view before the routes exist: the parent locks the drawer to
    // its single half-open snap now, so it can't be expanded and then yanked
    // back down the moment the results land.
    onClosestMedics?.([]);
    try {
      const res = await fetchClosestMedics(incident.lat, incident.lng, { incidentId: incident.id });
      setClosestMedics(res.medics);
      setClosestUnlocated(res.unlocatedCount);
      onClosestMedics?.(res.medics);
    } catch (err) {
      debugLog("api", "error", "closest medics failed", String(err));
      setClosestMedics([]);
      Alert.alert("Couldn't rank medics", "The routing service did not answer. Please try again.");
    } finally {
      setClosestLoading(false);
    }
  };

  const toggleClosestMedic = (medic: ClosestMedic) => {
    const next = selectedMedicId === medic.medicId ? null : medic.medicId;
    setSelectedMedicId(next);
    onSelectClosestMedic?.(next ? medic : null);
  };

  const assignClosestMedic = async (medic: ClosestMedic) => {
    if (assigningClosestId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAssigningClosestId(medic.medicId);
    try {
      await assignIncidentResponder(incident.id, medic.medicId);
      updateRespondersLocally([...responders, medic.medicId]);
      // Reflect it in the list rather than closing: dispatching a second medic
      // to the same incident is normal, and the ranking is still what you need.
      setClosestMedics((prev) =>
        prev.map((m) => (m.medicId === medic.medicId ? { ...m, assigned: true } : m)),
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      debugLog("api", "error", "assign closest medic failed", String(err));
      Alert.alert("Assign failed", `Could not assign ${medic.name}. Please try again.`);
    } finally {
      setAssigningClosestId(null);
    }
  };

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

  // ── In-drawer "closest medic" view: the five fastest responders, mirrored as
  //    colour-matched routes on the map above the drawer. ──
  if (closestView) {
    return (
      <ClosestMedicsPanel
        medics={closestMedics}
        unlocatedCount={closestUnlocated}
        loading={closestLoading}
        assigningId={assigningClosestId}
        selectedId={selectedMedicId}
        onBack={closeClosestView}
        onClose={onClose}
        onSelect={toggleClosestMedic}
        onAssign={(medic) => void assignClosestMedic(medic)}
      />
    );
  }

  // ── In-drawer "exit points" view: numbered asphalt access points, mirrored
  //    as numbered pins on the map above the drawer. ──
  if (asphaltView && asphaltPoints) {
    return (
      <View style={styles.root}>
        <View style={styles.asphaltViewHeader}>
          <Pressable style={styles.asphaltBackBtn} onPress={closeAsphaltView} hitSlop={8}>
            <Feather name="arrow-left" size={19} color="#cbd5e1" />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.asphaltViewTitle}>Closest asphalt</Text>
            <Text style={styles.asphaltViewSub} numberOfLines={1}>
              {asphaltPoints.length} exit point{asphaltPoints.length > 1 ? "s" : ""}
              {asphaltRadius ? ` · searched to ${formatDistance(asphaltRadius)}` : ""}
            </Text>
          </View>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
            <Feather name="x" size={18} color="#94a3b8" />
          </Pressable>
        </View>

        <BottomSheetScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
          {asphaltPoints.map((point) => {
            const direct = point.incident.direct;
            const selected = selectedExit === point.index;
            const label = exitLabel(point);
            const accent = exitColor(point);
            const surface = surfaceNote(point);
            const onRoadAlready = !direct && point.incident.distanceMeters < 30;
            return (
              <Pressable
                key={point.index}
                style={[
                  styles.exitCard,
                  { borderColor: selected ? `${accent}88` : `${accent}2e`, backgroundColor: `${accent}0f` },
                  selected && styles.exitCardSelected,
                ]}
                onPress={() => toggleExit(point)}
              >
                {/* The number is the distance rank, so it always shows; being the
                    recommended point is carried by the green accent + chip. */}
                <View style={[styles.exitBadge, { backgroundColor: accent }]}>
                  <Text style={styles.exitBadgeText} allowFontScaling={false}>{point.index}</Text>
                </View>

                <View style={styles.exitInfo}>
                  <View style={styles.exitTitleRow}>
                    <Text style={styles.exitTitle} numberOfLines={1}>
                      {point.roadHint ? point.roadHint.replace(/_/g, " ") : "Paved road"}
                    </Text>
                    {point.best ? (
                      <View style={[styles.exitChip, { backgroundColor: accent }]}>
                        <Text style={styles.exitChipTextDark} allowFontScaling={false}>BEST</Text>
                      </View>
                    ) : null}
                    {point.confidence === "unknown" ? (
                      <View style={styles.exitChipWarn}>
                        <Feather name="alert-triangle" size={8.5} color="#fbbf24" />
                        <Text style={styles.exitChipTextWarn} allowFontScaling={false}>UNVERIFIED</Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Foot and bike are shown side by side rather than blended —
                      the two profiles follow different networks. */}
                  {onRoadAlready ? (
                    <Text style={styles.exitMetric}>The incident is already on this road</Text>
                  ) : direct ? (
                    <View style={styles.exitMetricRow}>
                      <Feather name="arrow-up-right" size={11} color="#fbbf24" />
                      <Text style={[styles.exitMetric, { color: "#fcd34d" }]} numberOfLines={1}>
                        {formatDistance(point.incident.distanceMeters)} straight line — no route
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.exitPaceRow}>
                      {point.incident.foot ? (
                        <View style={styles.exitPace}>
                          <MaterialCommunityIcons name="walk" size={13} color="#cbd5e1" />
                          <Text style={styles.exitPaceText} allowFontScaling={false}>
                            {formatMinutes(point.incident.foot.durationMs)}
                          </Text>
                        </View>
                      ) : null}
                      {point.incident.bike ? (
                        <View style={styles.exitPace}>
                          <MaterialCommunityIcons name="bike" size={13} color="#cbd5e1" />
                          <Text style={styles.exitPaceText} allowFontScaling={false}>
                            {formatMinutes(point.incident.bike.durationMs)}
                          </Text>
                        </View>
                      ) : null}
                      <Text style={styles.exitPaceDistance} numberOfLines={1}>
                        {formatDistance(point.incident.distanceMeters)}
                      </Text>
                    </View>
                  )}

                  {/* The stretch the router used to hide: incident → trailhead. */}
                  {point.incident.offPathSignificant && point.incident.offPathMeters ? (
                    <View style={styles.exitMetricRow}>
                      <Feather name="corner-right-up" size={11} color="#94a3b8" />
                      <Text style={styles.exitMetric} numberOfLines={1}>
                        first {formatDistance(point.incident.offPathMeters)} off-path
                      </Text>
                    </View>
                  ) : null}

                  {surface ? (
                    <View style={styles.exitMetricRow}>
                      <Feather name="layers" size={11} color="#94a3b8" />
                      <Text style={styles.exitMetric} numberOfLines={1}>{surface}</Text>
                    </View>
                  ) : null}

                  {/* Me → point (car) */}
                  {point.fromMe ? (
                    <View style={styles.exitMetricRow}>
                      <Feather name="truck" size={11} color="#94a3b8" />
                      <Text style={styles.exitMetric} numberOfLines={1}>
                        You by car: {formatMinutes(point.fromMe.durationMs)} · {formatDistance(point.fromMe.distanceMeters)}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <Pressable
                  style={[styles.exitNavBtn, { backgroundColor: accent }]}
                  hitSlop={4}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    closeAsphaltView();
                    onClose();
                    useNavStore.getState().openTransport({ lat: point.lat, lng: point.lng, label });
                  }}
                >
                  <Feather name="navigation" size={16} color="#04121f" />
                </Pressable>
              </Pressable>
            );
          })}
          <Text style={styles.exitFootnote}>
            Numbered by distance from the incident; the green one is the fastest
            you can actually reach. Walk and bike times are separate — they follow
            different networks. Tap a card to draw its path, shaded by climb and
            descent. Amber points have no route at all.
          </Text>
        </BottomSheetScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* ── Hero header ──
          One identity line and one meta line. The category used to be repeated
          as a second full-width block below; it lives here now, next to the
          status and the distance, so the top of the sheet is a single glance
          instead of three competing ones. */}
      <View style={styles.header}>
        <View style={[styles.statusRail, { backgroundColor: status.color }]} />
        <View style={[styles.heroBadge, { borderColor: `${status.color}55`, backgroundColor: `${status.color}12` }]}>
          <Text style={styles.heroIcon}>{type.icon}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{incident.name ?? incident.label}</Text>
          <View style={styles.headerChips}>
            <View style={[styles.statusPill, { backgroundColor: `${status.color}22`, borderColor: `${status.color}66` }]}>
              <View style={[styles.statusDot, { backgroundColor: status.color }]} />
              <Text style={[styles.statusPillText, { color: status.color }]}>{status.label}</Text>
            </View>
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

      {/* Category · distance · age. Its own full-width row: squeezed in beside
          the status pill it had only the gap before the mic button to live in,
          and got clipped mid-word. Full width, but still one quiet line. */}
      <View style={styles.metaRow}>
        <Text style={styles.metaText} numberOfLines={1}>
          {[type.label, distanceKm != null ? `${distanceKm.toFixed(1)} km away` : null, reportedAgo]
            .filter(Boolean)
            .join("  ·  ")}
        </Text>
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

        {/* ── Dispatch pair: who can get here, and where a vehicle can reach.
            Split 50/50 — they answer the same question from two directions and
            neither deserves to be the wider one. ── */}
        {!isClosed ? (
          <View style={styles.dispatchRow}>
            <Pressable
              style={[styles.dispatchBtn, styles.dispatchMedic]}
              onPress={() => void loadClosestMedics()}
              disabled={closestLoading}
            >
              {closestLoading ? (
                <ActivityIndicator size="small" color="#6ee7b7" />
              ) : (
                <Text style={styles.dispatchIcon} allowFontScaling={false}>🚑</Text>
              )}
              <Text style={[styles.dispatchLabel, styles.dispatchLabelMedic]} numberOfLines={1}>
                Closest medic
              </Text>
            </Pressable>
            <Pressable
              style={[styles.dispatchBtn, styles.dispatchAsphalt]}
              onPress={() => void loadClosestAsphalt()}
              disabled={asphaltLoading}
            >
              {asphaltLoading ? (
                <ActivityIndicator size="small" color="#a5b4fc" />
              ) : (
                <Text style={styles.dispatchIcon} allowFontScaling={false}>🛣</Text>
              )}
              <Text style={[styles.dispatchLabel, styles.dispatchLabelAsphalt]} numberOfLines={1}>
                Closest asphalt
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* ── Patient card. Only rendered when there is something clinical to
            say — the medical chips are the reason a medic opens this sheet, so
            they sit above everything else and never behind a scroll. ── */}
        {(incident.patientName || incident.patientBib || incident.patientPhone ||
          incident.allergies || incident.medications || incident.bloodType || incident.conditions) ? (
          <View style={styles.patientCard}>
            <Text style={styles.patientKicker}>PATIENT INFO</Text>
            <View style={styles.patientHeadRow}>
              <Feather name="user" size={12} color="#fbbf24" />
              <Text style={styles.patientName} numberOfLines={1}>
                {incident.patientName ?? "Patient"}
                {incident.patientBib ? <Text style={styles.patientBib}>  #{incident.patientBib}</Text> : null}
              </Text>
              {incident.patientPhone ? (
                <Pressable
                  style={styles.callPill}
                  onPress={() => void Linking.openURL(`tel:${incident.patientPhone}`)}
                  hitSlop={6}
                >
                  <Feather name="phone" size={11} color="#04121f" />
                  <Text style={styles.callPillText} allowFontScaling={false}>Call</Text>
                </Pressable>
              ) : null}
            </View>
            {(incident.allergies || incident.medications || incident.bloodType || incident.conditions) ? (
              <View style={styles.medChipRow}>
                {incident.bloodType ? (
                  <Text style={[styles.medChip, styles.bloodChip]} numberOfLines={1}>🩸 {incident.bloodType}</Text>
                ) : null}
                {incident.allergies ? (
                  <Text style={[styles.medChip, styles.allergyChip]} numberOfLines={1}>⚠ {incident.allergies}</Text>
                ) : null}
                {incident.medications ? (
                  <Text style={[styles.medChip, styles.medsChip]} numberOfLines={1}>💊 {incident.medications}</Text>
                ) : null}
                {incident.conditions ? (
                  <Text style={[styles.medChip, styles.conditionChip]} numberOfLines={1}>🩺 {incident.conditions}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ── Provenance: one quiet line, with a call pill when we have a
            number for whoever raised it. ── */}
        <View style={styles.reporterRow}>
          <Feather name="radio" size={11} color="#5b6b80" />
          <Text style={styles.reporterText} numberOfLines={1}>
            <Text style={styles.reporterLabel}>Reported by: </Text>
            {incident.reportedBy ?? "Unknown"} ({reporterRole(incident.createdBy)})
          </Text>
          {incident.reporterPhone ? (
            <Pressable
              style={styles.reporterCall}
              onPress={() => void Linking.openURL(`tel:${incident.reporterPhone}`)}
              hitSlop={6}
            >
              <Feather name="phone" size={10.5} color="#34d399" />
              <Text style={styles.reporterCallText} allowFontScaling={false}>{incident.reporterPhone}</Text>
            </Pressable>
          ) : null}
          {/* Coordinator-only: relocate the pin. A quiet affordance at the end
              of the provenance line rather than a full-width button — it is a
              correction, not an action anyone takes on most incidents. */}
          {amCoordinator && !isClosed && onMoveLocation ? (
            <Pressable
              style={styles.moveChip}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onMoveLocation();
              }}
              hitSlop={6}
            >
              <Feather name="move" size={10.5} color="#7dd3fc" />
              <Text style={styles.moveChipText} allowFontScaling={false}>Move</Text>
            </Pressable>
          ) : null}
        </View>

        {/* ── Notes (may include the patient's medical info, then the
            reporter's own description) ── */}
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
            <Text style={styles.sectionKicker}>RESPONDERS{responders.length ? ` (${responders.length})` : ""}</Text>
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
                  // Casualty handover — the closing summary, spelled out in the
                  // log rather than hidden behind a one-line "closed by X".
                  if (m.kind === "handover") {
                    const meta = (m.meta ?? {}) as {
                      by?: string;
                      vitals?: string;
                      treatment?: string;
                      transport?: string;
                    };
                    const rows: Array<[string, string]> = [];
                    if (meta.vitals) rows.push(["Vitals", meta.vitals]);
                    if (meta.treatment) rows.push(["Treatment", meta.treatment]);
                    if (meta.transport) rows.push(["Transport", meta.transport]);
                    return (
                      <View key={m.id} style={styles.handoverCard}>
                        <View style={styles.handoverHeader}>
                          <Feather name="clipboard" size={10} color="#22c55e" />
                          <Text style={styles.handoverKicker}>CASUALTY HANDOVER</Text>
                          <Text style={styles.handoverTime}>
                            {meta.by ? `${meta.by} · ` : ""}
                            {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </Text>
                        </View>
                        {rows.length === 0 ? (
                          <Text style={styles.handoverEmpty}>Closed without handover notes.</Text>
                        ) : (
                          rows.map(([label, value]) => (
                            <Text key={label} style={styles.handoverValue}>
                              <Text style={styles.handoverLabel}>{label}: </Text>
                              {value}
                            </Text>
                          ))
                        )}
                      </View>
                    );
                  }
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
                  // Guided-care entries from the runner app (triage answers,
                  // CPR start/stop) render as compact one-line timeline pills —
                  // there can be a dozen of them, so they must not eat the chat.
                  if (m.kind === "first_aid" || m.kind === "cpr") {
                    const isCpr = m.kind === "cpr";
                    const meta = (m.meta ?? {}) as { question?: string; answer?: string };
                    const primary = isCpr
                      ? m.text
                      : meta.answer ?? m.text.replace(/^First aid:\s*/i, "");
                    return (
                      <View key={m.id} style={styles.careChipRow}>
                        <View style={[styles.careChip, isCpr ? styles.careChipCpr : null]}>
                          <Feather
                            name={isCpr ? "heart" : "clipboard"}
                            size={10}
                            color={isCpr ? "#f87171" : "#34d399"}
                            style={styles.careChipIcon}
                          />
                          <Text style={styles.careChipText}>
                            {!isCpr && meta.question ? (
                              <Text style={styles.careChipQuestionInline}>{meta.question} · </Text>
                            ) : null}
                            {primary}
                          </Text>
                          <Text style={styles.careChipTime}>
                            {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </Text>
                        </View>
                      </View>
                    );
                  }
                  const mine = m.authorId === myId;
                  const playing = playingMessageId === m.id;
                  return (
                    <View
                      key={m.id}
                      style={[
                        styles.bubble,
                        mine ? styles.bubbleMine : styles.bubbleOther,
                        (m.kind === "voice" || m.audioUrl) && styles.bubbleVoice,
                      ]}
                    >
                      {!mine ? <Text style={styles.bubbleAuthor}>{m.authorName}</Text> : null}
                      {/* Copied in from the team chat because its author was
                          standing on this incident when they said it. */}
                      {(m.meta as { mirroredFrom?: string } | undefined)?.mirroredFrom === "event-chat" ? (
                        <Text style={styles.bubbleMirrorTag}>📻 FROM TEAM CHAT</Text>
                      ) : null}
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
                            <TranscriptText
                              text={m.transcript}
                              style={styles.voiceTranscript}
                              containerStyle={styles.voiceTranscriptBox}
                              // The incident bubble is narrower than the team
                              // chat's, so the same transcript wrapped onto a
                              // 4th line and the 3-line clamp ate the last few
                              // words — reading exactly like a failed
                              // transcription. This is the casualty record;
                              // show it, and only fold genuinely long notes.
                              maxLines={12}
                            />
                          ) : null}
                        </>
                      ) : m.photoUrl ? (
                        <>
                          <Pressable
                            onPress={() => {
                              const resolved = resolveMediaUrl(m.photoUrl);
                              if (resolved) onOpenPhoto(resolved);
                            }}
                          >
                            <Image source={{ uri: resolveMediaUrl(m.photoUrl) }} style={styles.chatPhoto} />
                          </Pressable>
                          {m.text ? <Text style={styles.bubbleText}>{m.text}</Text> : null}
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

  // Header — tightened: a 44px badge, one title line, one meta line.
  header: { flexDirection: "row", alignItems: "center", gap: 11, paddingLeft: 14, paddingRight: 16, paddingBottom: 11 },
  // Vertical status accent: colour without spending a row on it.
  statusRail: { width: 3, height: 40, borderRadius: 2, opacity: 0.9 },
  heroBadge: {
    width: 44,
    height: 44,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  heroIcon: { fontSize: 21 },
  headerText: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: "#f4f8ff", fontSize: 18, fontWeight: "900", letterSpacing: 0.2 },
  headerChips: { flexDirection: "row", alignItems: "center", gap: 7 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4.5,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 2.5,
    paddingHorizontal: 8,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 10.5, fontWeight: "900", letterSpacing: 0.3 },
  headerMeta: { color: "#8da3bd", fontSize: 11.5, fontWeight: "700", flexShrink: 1 },
  // Category · distance · age, on its own line under the header.
  metaRow: { paddingHorizontal: 18, paddingBottom: 10, marginTop: -4 },
  metaText: { color: "#8da3bd", fontSize: 11.5, fontWeight: "700" },
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

  // Dispatch pair (closest medic | closest asphalt), equal halves.
  dispatchRow: { flexDirection: "row", gap: 9, marginTop: 10 },
  dispatchBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  dispatchMedic: { borderColor: "rgba(52,211,153,0.34)", backgroundColor: "rgba(34,197,94,0.09)" },
  dispatchAsphalt: { borderColor: "rgba(129,140,248,0.32)", backgroundColor: "rgba(99,102,241,0.09)" },
  dispatchIcon: { fontSize: 15, lineHeight: 18, includeFontPadding: false },
  dispatchLabel: { fontSize: 12.5, fontWeight: "800", flexShrink: 1 },
  dispatchLabelMedic: { color: "#6ee7b7" },
  dispatchLabelAsphalt: { color: "#a5b4fc" },

  // Patient card — the clinical picture, above everything else.
  patientCard: {
    backgroundColor: "rgba(245,158,11,0.07)",
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.24)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  patientKicker: { color: "#d6a441", fontSize: 9.5, fontWeight: "900", letterSpacing: 1.2 },
  patientHeadRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  patientName: { flex: 1, color: "#fde68a", fontSize: 14, fontWeight: "900" },
  patientBib: { color: "#d6bd7a", fontSize: 12.5, fontWeight: "800" },
  callPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#34d399",
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  callPillText: { color: "#04121f", fontSize: 11, fontWeight: "900" },
  medChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },

  // Provenance line
  reporterRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 },
  reporterText: { color: "#7d8ea4", fontSize: 11.5, fontWeight: "700", flexShrink: 1 },
  reporterLabel: { color: "#5b6b80", fontWeight: "800" },
  reporterCall: { flexDirection: "row", alignItems: "center", gap: 4 },
  reporterCallText: { color: "#34d399", fontSize: 11.5, fontWeight: "800" },
  moveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.28)",
    backgroundColor: "rgba(56,189,248,0.08)",
    paddingVertical: 3.5,
    paddingHorizontal: 9,
  },
  moveChipText: { color: "#7dd3fc", fontSize: 11, fontWeight: "800" },
  medChip: { fontSize: 11.5, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: "hidden", maxWidth: "100%" },
  allergyChip: { backgroundColor: "rgba(239,68,68,0.16)", color: "#fca5a5" },
  medsChip: { backgroundColor: "rgba(168,85,247,0.16)", color: "#c4b5fd" },
  bloodChip: { backgroundColor: "rgba(239,68,68,0.22)", color: "#fca5a5" },
  conditionChip: { backgroundColor: "rgba(245,158,11,0.16)", color: "#fcd34d" },

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
  // Guided-care chips (first-aid answers / CPR from the runner app)
  careChipRow: { alignItems: "center", paddingVertical: 1 },
  // Compact but never truncating: text wraps, icon/time hug the first line.
  careChip: {
    maxWidth: "94%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    borderRadius: 11,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: "rgba(52,211,153,0.07)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.22)",
  },
  careChipCpr: { backgroundColor: "rgba(248,113,113,0.08)", borderColor: "rgba(248,113,113,0.25)" },
  careChipIcon: { marginTop: 3 },
  careChipTime: { color: "#48586c", fontSize: 9.5, fontWeight: "700", marginTop: 2 },
  careChipText: { color: "#e2ecf7", fontSize: 11.5, fontWeight: "800", flexShrink: 1, lineHeight: 16 },
  careChipQuestionInline: { color: "#7d8ea4", fontWeight: "600" },
  // Casualty handover, shown inline in the log when the incident is closed.
  handoverCard: {
    borderRadius: 12,
    paddingVertical: 7,
    paddingHorizontal: 10,
    gap: 3,
    backgroundColor: "rgba(34,197,94,0.07)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.22)",
  },
  handoverHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  handoverKicker: { color: "#22c55e", fontSize: 9.5, fontWeight: "900", letterSpacing: 0.6 },
  handoverTime: { color: "#48586c", fontSize: 9.5, fontWeight: "700", flex: 1, textAlign: "right" },
  handoverLabel: { color: "#7d8ea4", fontWeight: "800" },
  handoverValue: { color: "#dbe7f3", fontSize: 11.5, fontWeight: "600", lineHeight: 16 },
  handoverEmpty: { color: "#7d8ea4", fontSize: 11.5, fontWeight: "600" },
  bubble: { maxWidth: "85%", borderRadius: 13, paddingVertical: 7, paddingHorizontal: 11 },
  /** Voice notes: the transcript is the content, so give it nearly the full row. */
  bubbleVoice: { maxWidth: "97%" },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: "rgba(34,197,94,0.16)", borderTopRightRadius: 4 },
  bubbleOther: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.05)", borderTopLeftRadius: 4 },
  bubbleAuthor: { color: "#93c5fd", fontSize: 10.5, fontWeight: "900", marginBottom: 2 },
  bubbleMirrorTag: { color: "#7dd3fc", fontSize: 9, fontWeight: "900", letterSpacing: 0.6, marginBottom: 3 },
  bubbleText: { color: "#dbe5f1", fontSize: 13, lineHeight: 18 },
  chatPhoto: { width: 180, height: 135, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.05)" },
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
  voiceTranscript: { color: "#aeb9c9", fontSize: 12, lineHeight: 16, fontStyle: "italic" },
  voiceTranscriptBox: { marginTop: 6, alignSelf: "stretch" },
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

  // ── In-drawer exit-points view ──
  asphaltViewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(148,163,184,0.18)",
  },
  asphaltBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  asphaltViewTitle: { color: "#EFF6FF", fontSize: 17, fontWeight: "900", letterSpacing: 0.2 },
  asphaltViewSub: { color: "#64748b", fontSize: 11.5, fontWeight: "600" },
  exitCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  // Colour comes from the point's accent (green best / indigo routed / amber
  // unroutable) so the card, the map pin and the drawn path always agree.
  exitCardSelected: { borderWidth: 1.5 },
  exitBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  exitBadgeText: { color: "#ffffff", fontSize: 13, fontWeight: "900" },
  exitInfo: { flex: 1, minWidth: 0, gap: 3 },
  exitTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  exitTitle: { color: "#E9F1FA", fontSize: 14, fontWeight: "800", textTransform: "capitalize", flexShrink: 1 },
  exitChip: { paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 5 },
  exitChipTextDark: { color: "#04121f", fontSize: 8.5, fontWeight: "900", letterSpacing: 0.5 },
  exitChipWarn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 5,
    backgroundColor: "rgba(245,158,11,0.16)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.4)",
  },
  exitChipTextWarn: { color: "#fbbf24", fontSize: 8.5, fontWeight: "900", letterSpacing: 0.4 },
  // Walk / bike times sit side by side, each behind its own glyph.
  exitPaceRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 1 },
  exitPace: { flexDirection: "row", alignItems: "center", gap: 4 },
  exitPaceText: { color: "#E9F1FA", fontSize: 13.5, fontWeight: "800", includeFontPadding: false },
  exitPaceDistance: { color: "#7e93ac", fontSize: 12, fontWeight: "600", flexShrink: 1 },
  exitMetricRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  exitMetric: { color: "#94a3b8", fontSize: 12, fontWeight: "600", flex: 1 },
  exitNavBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  exitFootnote: { color: "#475569", fontSize: 11, fontWeight: "500", textAlign: "center", marginTop: 4 },

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
