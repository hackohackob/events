import React, { useCallback, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFooter,
  type BottomSheetFooterProps,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { updateIncident, uploadIncidentPhoto } from "./incident-api";
import {
  type IncidentSeverity,
  type IncidentType,
  useIncidentStore,
} from "./incident-store";

const INCIDENT_TYPES: Array<{ id: IncidentType; label: string; icon: string; color: string }> = [
  { id: "medical", label: "Medical", icon: "🏥", color: "#FF6B6B" },
  { id: "cardiac", label: "Cardiac", icon: "❤️", color: "#FF3B3B" },
  { id: "trauma", label: "Trauma", icon: "🩹", color: "#FF9F40" },
  { id: "fracture", label: "Fracture", icon: "🦴", color: "#A78BFA" },
  { id: "unconscious", label: "Unconscious", icon: "😵", color: "#60A5FA" },
  { id: "other", label: "Other", icon: "⚠️", color: "#6B7F9A" },
];

const SEVERITIES: Array<{ id: IncidentSeverity; label: string; color: string }> = [
  { id: "low", label: "Low", color: "#22c55e" },
  { id: "medium", label: "Medium", color: "#eab308" },
  { id: "high", label: "High", color: "#f97316" },
  { id: "critical", label: "Critical", color: "#ef4444" },
];

const SHEET_SNAP_POINTS = ["80%", "96%"];

// ─── Live creation-status banner ──────────────────────────────────────────────

function StatusBanner() {
  const status = useIncidentStore((s) => s.creationStatus);
  const name = useIncidentStore((s) => s.incidentName);
  const nearby = useIncidentStore((s) => s.nearbyParamedics);

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (status !== "creating") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [status, pulse]);

  if (status === "creating") {
    return (
      <View style={[styles.banner, styles.bannerCreating]}>
        <ActivityIndicator size="small" color="#60a5fa" />
        <View style={styles.bannerTextWrap}>
          <Text style={styles.bannerTitle}>Reporting…</Text>
          <Text style={styles.bannerSub}>Pinpointing your location & alerting the team</Text>
        </View>
      </View>
    );
  }

  if (status === "failed") {
    return (
      <View style={[styles.banner, styles.bannerOffline]}>
        <Feather name="wifi-off" size={18} color="#fbbf24" />
        <View style={styles.bannerTextWrap}>
          <Text style={[styles.bannerTitle, { color: "#fde68a" }]}>Saved offline</Text>
          <Text style={[styles.bannerSub, { color: "#fcd34d" }]}>It’ll send automatically when you’re back online</Text>
        </View>
      </View>
    );
  }

  // created
  const count = (nearby ?? []).length;
  return (
    <View style={[styles.banner, styles.bannerLive]}>
      <View style={styles.liveDot} />
      <View style={styles.bannerTextWrap}>
        <Text style={[styles.bannerTitle, { color: "#86efac" }]}>
          {name ?? "Incident"} is live
        </Text>
        <Text style={[styles.bannerSub, { color: "#6ee7b7" }]}>
          {count > 0 ? `${count} responder${count > 1 ? "s" : ""} nearby · alerted` : "Responders alerted"}
        </Text>
      </View>
      <Feather name="check-circle" size={20} color="#34d399" />
    </View>
  );
}

// ─── Severity selector ────────────────────────────────────────────────────────

function SeveritySelector() {
  const severity = useIncidentStore((s) => s.severity);
  const setSeverity = useIncidentStore((s) => s.setSeverity);
  return (
    <View style={styles.severityRow}>
      {SEVERITIES.map((s) => {
        const active = severity === s.id;
        return (
          <Pressable
            key={s.id}
            onPress={() => {
              setSeverity(s.id);
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            style={[
              styles.sevPill,
              { borderColor: active ? s.color : "rgba(148,163,184,0.18)" },
              active && { backgroundColor: s.color },
            ]}
          >
            <View style={[styles.sevDot, { backgroundColor: active ? "#04121f" : s.color }]} />
            <Text style={[styles.sevText, active && { color: "#04121f" }]}>{s.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Type grid ────────────────────────────────────────────────────────────────

function TypeGrid() {
  const incidentType = useIncidentStore((s) => s.incidentType);
  const setIncidentType = useIncidentStore((s) => s.setIncidentType);

  const scales = useRef(
    new Map(INCIDENT_TYPES.map((t) => [t.id, new Animated.Value(1)])),
  ).current;

  const select = (id: IncidentType) => {
    setIncidentType(id);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const v = scales.get(id)!;
    v.setValue(0.9);
    Animated.spring(v, { toValue: 1, damping: 12, stiffness: 320, useNativeDriver: true }).start();
  };

  return (
    <View style={styles.typeGrid}>
      {INCIDENT_TYPES.map((type) => {
        const selected = incidentType === type.id;
        return (
          <Animated.View key={type.id} style={{ transform: [{ scale: scales.get(type.id)! }], width: "31%" }}>
            <Pressable
              onPress={() => select(type.id)}
              style={[
                styles.typeCard,
                selected && { borderColor: type.color, backgroundColor: `${type.color}1f` },
              ]}
            >
              <Text style={styles.typeIcon}>{type.icon}</Text>
              <Text style={[styles.typeLabel, selected && { color: type.color }]}>{type.label}</Text>
              {selected ? (
                <View style={[styles.typeCheck, { backgroundColor: type.color }]}>
                  <Feather name="check" size={9} color="#04121f" />
                </View>
              ) : null}
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

// ─── Sheet ────────────────────────────────────────────────────────────────────

export function ReportIncidentSheet() {
  const phase = useIncidentStore((s) => s.phase);
  const creationStatus = useIncidentStore((s) => s.creationStatus);
  const incidentId = useIncidentStore((s) => s.incidentId);
  const description = useIncidentStore((s) => s.description);
  const photoUri = useIncidentStore((s) => s.photoUri);
  const incidentType = useIncidentStore((s) => s.incidentType);
  const severity = useIncidentStore((s) => s.severity);
  const peopleAffected = useIncidentStore((s) => s.peopleAffected);
  const setDescription = useIncidentStore((s) => s.setDescription);
  const setPhotoUri = useIncidentStore((s) => s.setPhotoUri);
  const reset = useIncidentStore((s) => s.reset);

  const sheetRef = useRef<BottomSheet>(null);
  const saving = useRef(false);
  const skipResetOnDismiss = useRef(false);

  useEffect(() => {
    if (phase === "details") {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [phase]);

  const handleDismissed = useCallback(() => {
    if (skipResetOnDismiss.current) {
      skipResetOnDismiss.current = false;
      return;
    }
    reset();
  }, [reset]);

  const closeAndReset = useCallback(() => {
    skipResetOnDismiss.current = true;
    sheetRef.current?.close();
    reset();
  }, [reset]);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.5} pressBehavior="none" />
    ),
    [],
  );

  const pickPhoto = async (useCamera: boolean) => {
    try {
      // Request the relevant permission first — without this the native picker
      // silently fails to open on Android.
      const perm = useCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          useCamera ? "Camera access needed" : "Photo access needed",
          useCamera
            ? "Enable camera access in Settings to attach a photo."
            : "Enable photo access in Settings to attach a photo.",
        );
        return;
      }

      const result = useCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: true })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: true, mediaTypes: ["images"] });
      if (!result.canceled && result.assets[0]) {
        setPhotoUri(result.assets[0].uri);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (err) {
      Alert.alert("Couldn’t open", "Something went wrong opening the picker. Please try again.");
      console.warn("[ReportIncidentSheet] pickPhoto failed", err);
    }
  };

  const handleSave = useCallback(async () => {
    if (!incidentId || saving.current) return;
    saving.current = true;
    Keyboard.dismiss();
    try {
      let photoUrl: string | undefined;
      if (photoUri) {
        try {
          photoUrl = await uploadIncidentPhoto(incidentId, photoUri);
        } catch {
          // non-fatal — save the rest
        }
      }
      await updateIncident(incidentId, {
        type: incidentType ?? "other",
        peopleAffected,
        description,
        photoUrl,
        severity: severity ?? undefined,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      closeAndReset();
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      saving.current = false;
    }
  }, [incidentId, photoUri, incidentType, peopleAffected, description, severity, closeAndReset]);

  const canSave = creationStatus === "created" && !!incidentId;

  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props} bottomInset={0}>
        <View style={styles.footer}>
          <Pressable
            style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!canSave}
          >
            {creationStatus === "creating" ? (
              <>
                <ActivityIndicator size="small" color="#04121f" />
                <Text style={styles.saveBtnText}>Reporting…</Text>
              </>
            ) : creationStatus === "failed" ? (
              <Text style={styles.saveBtnText}>Saved offline</Text>
            ) : (
              <>
                <Feather name="check" size={18} color="#04121f" />
                <Text style={styles.saveBtnText}>Save details</Text>
              </>
            )}
          </Pressable>
          <Pressable style={styles.dismissBtn} onPress={closeAndReset}>
            <Text style={styles.dismissText}>{canSave ? "Skip" : "Done"}</Text>
          </Pressable>
        </View>
      </BottomSheetFooter>
    ),
    [canSave, creationStatus, handleSave, closeAndReset],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={SHEET_SNAP_POINTS}
      enableDynamicSizing={false}
      enablePanDownToClose
      onClose={handleDismissed}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.sheetHandleIndicator}
      backdropComponent={renderBackdrop}
      footerComponent={renderFooter}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
    >
      <BottomSheetScrollView
        style={styles.scrollBody}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <StatusBanner />

        <Text style={styles.title}>Add details</Text>
        <Text style={styles.subtitle}>A quick tap is plenty — every detail helps responders prepare.</Text>

        <Text style={styles.fieldLabel}>SEVERITY</Text>
        <SeveritySelector />

        <Text style={styles.fieldLabel}>TYPE OF INCIDENT</Text>
        <TypeGrid />

        <Text style={styles.fieldLabel}>DESCRIPTION</Text>
        <BottomSheetTextInput
          style={styles.descriptionInput}
          multiline
          placeholder="What happened? Anything responders should know…"
          placeholderTextColor="#4A5F7A"
          value={description}
          onChangeText={setDescription}
          textAlignVertical="top"
        />

        <Text style={styles.fieldLabel}>PHOTO</Text>
        {photoUri ? (
          <View style={styles.photoPreviewRow}>
            <Image source={{ uri: photoUri }} style={styles.photoThumb} />
            <View style={styles.photoInfo}>
              <Text style={styles.photoFilename}>Photo attached</Text>
              <Pressable onPress={() => setPhotoUri(null)} hitSlop={8}>
                <Text style={styles.photoRemove}>Remove</Text>
              </Pressable>
            </View>
            <Feather name="image" size={20} color="#34d399" />
          </View>
        ) : (
          <View style={styles.photoRow}>
            <Pressable style={styles.photoBtn} onPress={() => pickPhoto(true)}>
              <Feather name="camera" size={20} color="#93C5FD" />
              <Text style={styles.photoBtnLabel}>Camera</Text>
            </Pressable>
            <Pressable style={styles.photoBtn} onPress={() => pickPhoto(false)}>
              <Feather name="image" size={20} color="#93C5FD" />
              <Text style={styles.photoBtnLabel}>Gallery</Text>
            </Pressable>
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: "#090f1d",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetHandleIndicator: {
    backgroundColor: "rgba(177, 199, 224, 0.28)",
    width: 40,
    height: 4,
  },
  scrollBody: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 130 },

  // Banner
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 18,
    borderWidth: 1,
  },
  bannerCreating: { backgroundColor: "rgba(59,130,246,0.1)", borderColor: "rgba(59,130,246,0.28)" },
  bannerLive: { backgroundColor: "rgba(16,185,129,0.1)", borderColor: "rgba(16,185,129,0.3)" },
  bannerOffline: { backgroundColor: "rgba(245,158,11,0.1)", borderColor: "rgba(245,158,11,0.3)" },
  bannerTextWrap: { flex: 1 },
  bannerTitle: { color: "#93c5fd", fontSize: 14, fontWeight: "900", letterSpacing: 0.2 },
  bannerSub: { color: "#7dd3fc", fontSize: 12, fontWeight: "600", marginTop: 1 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#34d399" },

  title: { color: "#EFF6FF", fontSize: 22, fontWeight: "900", letterSpacing: 0.2 },
  subtitle: { color: "#6B7F9A", fontSize: 13, fontWeight: "500", marginTop: 4, marginBottom: 6 },

  fieldLabel: {
    color: "#4A5F7A",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.3,
    marginTop: 22,
    marginBottom: 10,
  },

  // Severity
  severityRow: { flexDirection: "row", gap: 8 },
  sevPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 13,
    borderWidth: 1.5,
    backgroundColor: "#101d32",
  },
  sevDot: { width: 7, height: 7, borderRadius: 4 },
  sevText: { color: "#cbd5e1", fontSize: 12.5, fontWeight: "800" },

  // Type grid
  typeGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  typeCard: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101d32",
    borderRadius: 16,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: "rgba(177, 199, 224, 0.12)",
    gap: 6,
    minHeight: 84,
  },
  typeIcon: { fontSize: 26 },
  typeLabel: { color: "#94A3B8", fontSize: 12, fontWeight: "800", letterSpacing: 0.2 },
  typeCheck: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  descriptionInput: {
    backgroundColor: "#101d32",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.12)",
    color: "#EFF6FF",
    fontSize: 14,
    fontWeight: "500",
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 96,
  },

  photoRow: { flexDirection: "row", gap: 10 },
  photoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#101d32",
    borderRadius: 14,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.12)",
  },
  photoBtnLabel: { color: "#93C5FD", fontSize: 13, fontWeight: "800" },
  photoPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#101d32",
    borderRadius: 14,
    padding: 12,
    gap: 14,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.12)",
  },
  photoThumb: { width: 56, height: 56, borderRadius: 10 },
  photoInfo: { flex: 1 },
  photoFilename: { color: "#EFF6FF", fontSize: 13, fontWeight: "700" },
  photoRemove: { color: "#FF6B6B", fontSize: 12, fontWeight: "700", marginTop: 4 },

  // Footer
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 26, backgroundColor: "rgba(9,15,29,0.98)" },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: "#34d399",
    borderRadius: 16,
    paddingVertical: 16,
    shadowColor: "#34d399",
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  saveBtnDisabled: { backgroundColor: "#1f4f43" },
  saveBtnText: { color: "#04121f", fontSize: 16, fontWeight: "900", letterSpacing: 0.3 },
  dismissBtn: { alignItems: "center", paddingVertical: 12 },
  dismissText: { color: "#64748b", fontSize: 13, fontWeight: "700" },
});
