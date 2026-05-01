import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Image,
  Keyboard,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { updateIncident, uploadIncidentPhoto } from "./incident-api";
import { type IncidentType, type NearbyParamedic, useIncidentStore } from "./incident-store";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const BOTTOM_MENU_HEIGHT = 60;
const SHEET_PEEK_HEIGHT = 400;
const SHEET_HEIGHT = Math.max(400, SCREEN_HEIGHT - 88 - BOTTOM_MENU_HEIGHT);
const SHEET_EXPANDED_Y = 0;
const SHEET_COLLAPSED_Y = Math.max(0, SHEET_HEIGHT - SHEET_PEEK_HEIGHT);
const SHEET_HIDDEN_Y = SHEET_HEIGHT + 40;

const INCIDENT_TYPES: Array<{ id: IncidentType; label: string; icon: string; color: string }> = [
  { id: "medical", label: "Medical", icon: "🏥", color: "#FF6B6B" },
  { id: "cardiac", label: "Cardiac", icon: "❤️", color: "#FF3B3B" },
  { id: "trauma", label: "Trauma", icon: "🩹", color: "#FF9F40" },
  { id: "fracture", label: "Fracture", icon: "🦴", color: "#A78BFA" },
  { id: "unconscious", label: "Unconscious", icon: "😵", color: "#60A5FA" },
  { id: "other", label: "Other", icon: "⚠️", color: "#6B7F9A" },
];

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function Checkmark({ visible }: { visible: boolean }) {
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: visible ? 1 : 0,
      damping: 18,
      mass: 0.8,
      stiffness: 340,
      useNativeDriver: true,
    }).start();
  }, [visible, scale]);

  return (
    <Animated.View style={[styles.checkmarkWrap, { transform: [{ scale }] }]}>
      <View style={styles.checkmarkCircle}>
        <View style={styles.checkmarkShort} />
        <View style={styles.checkmarkLong} />
      </View>
    </Animated.View>
  );
}

function OfflineBanner({ visible }: { visible: boolean }) {
  const translateY = useRef(new Animated.Value(-60)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : -60,
      damping: 28,
      mass: 1,
      stiffness: 280,
      useNativeDriver: true,
    }).start();
  }, [visible, translateY]);

  return (
    <Animated.View style={[styles.offlineBanner, { transform: [{ translateY }] }]} pointerEvents="none">
      <Text style={styles.offlineBannerIcon}>📡</Text>
      <View>
        <Text style={styles.offlineBannerTitle}>Saved offline</Text>
        <Text style={styles.offlineBannerSub}>Move to an area with internet to send</Text>
      </View>
    </Animated.View>
  );
}

function LoadingDots() {
  const dots = [
    useRef(new Animated.Value(0.3)).current,
    useRef(new Animated.Value(0.3)).current,
    useRef(new Animated.Value(0.3)).current,
  ];

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          Animated.delay(600 - i * 150),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.dotsRow}>
      {dots.map((dot, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity: dot }]} />
      ))}
    </View>
  );
}

function ParamedicRow({ paramedic }: { paramedic: NearbyParamedic }) {
  const initials = paramedic.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={styles.paramedicRow}>
      <View style={styles.paramedicAvatar}>
        <Text style={styles.paramedicAvatarText}>{initials}</Text>
      </View>
      <View style={styles.paramedicInfo}>
        <Text style={styles.paramedicName}>{paramedic.name}</Text>
        {paramedic.vehicle ? <Text style={styles.paramedicVehicle}>{paramedic.vehicle}</Text> : null}
      </View>
      <View style={styles.paramedicDistanceBadge}>
        <Text style={styles.paramedicDistanceText}>{formatDistance(paramedic.distanceMeters)}</Text>
      </View>
    </View>
  );
}

function TypeChipGrid() {
  const incidentType = useIncidentStore((s) => s.incidentType);
  const setIncidentType = useIncidentStore((s) => s.setIncidentType);

  const chipScales = useRef(
    new Map(INCIDENT_TYPES.map((t) => [t.id, new Animated.Value(incidentType === t.id ? 1 : 0.96)])),
  ).current;

  const handleSelect = (id: IncidentType) => {
    const prev = incidentType;
    setIncidentType(id);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (prev && prev !== id) {
      Animated.spring(chipScales.get(prev)!, {
        toValue: 0.96,
        damping: 20,
        mass: 0.7,
        stiffness: 340,
        useNativeDriver: true,
      }).start();
    }
    Animated.spring(chipScales.get(id)!, {
      toValue: 1,
      damping: 20,
      mass: 0.7,
      stiffness: 340,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={styles.chipGrid}>
      {INCIDENT_TYPES.map((type) => {
        const selected = incidentType === type.id;
        return (
          <Animated.View key={type.id} style={{ transform: [{ scale: chipScales.get(type.id)! }], flex: 1, minWidth: "30%" }}>
            <Pressable
              onPress={() => handleSelect(type.id)}
              style={[styles.chip, selected && { borderColor: type.color, backgroundColor: `${type.color}1a` }]}
            >
              <Text style={styles.chipIcon}>{type.icon}</Text>
              <Text style={[styles.chipLabel, selected && { color: type.color }]}>{type.label}</Text>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

function PeopleCounter() {
  const count = useIncidentStore((s) => s.peopleAffected);
  const setCount = useIncidentStore((s) => s.setPeopleAffected);
  const bounce = useRef(new Animated.Value(1)).current;

  const animateBounce = () => {
    bounce.setValue(1.28);
    Animated.spring(bounce, {
      toValue: 1,
      damping: 14,
      mass: 0.6,
      stiffness: 320,
      useNativeDriver: true,
    }).start();
  };

  const increment = () => {
    setCount(count + 1);
    animateBounce();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const decrement = () => {
    if (count <= 1) return;
    setCount(count - 1);
    animateBounce();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <View style={styles.counter}>
      <Pressable onPress={decrement} style={[styles.counterBtn, count <= 1 && styles.counterBtnDisabled]}>
        <Text style={styles.counterBtnText}>−</Text>
      </Pressable>
      <Animated.View style={{ transform: [{ scale: bounce }] }}>
        <Text style={styles.counterNumber}>{count}</Text>
        <Text style={styles.counterLabel}>{count === 1 ? "person" : "people"}</Text>
      </Animated.View>
      <Pressable onPress={increment} style={styles.counterBtn}>
        <Text style={styles.counterBtnText}>+</Text>
      </Pressable>
    </View>
  );
}

export function ReportIncidentSheet() {
  const phase = useIncidentStore((s) => s.phase);
  const nearbyParamedics = useIncidentStore((s) => s.nearbyParamedics);
  const incidentId = useIncidentStore((s) => s.incidentId);
  const description = useIncidentStore((s) => s.description);
  const photoUri = useIncidentStore((s) => s.photoUri);
  const incidentType = useIncidentStore((s) => s.incidentType);
  const peopleAffected = useIncidentStore((s) => s.peopleAffected);
  const setDescription = useIncidentStore((s) => s.setDescription);
  const setPhotoUri = useIncidentStore((s) => s.setPhotoUri);
  const setPhase = useIncidentStore((s) => s.setPhase);
  const reset = useIncidentStore((s) => s.reset);

  const sheetBase = useRef(new Animated.Value(SHEET_HIDDEN_Y)).current;
  const sheetDrag = useRef(new Animated.Value(0)).current;
  const isSubmittingDetails = useRef(false);

  const animateSheet = (toValue: number, cb?: () => void) => {
    Animated.spring(sheetBase, {
      toValue,
      damping: 28,
      mass: 1,
      stiffness: 280,
      useNativeDriver: true,
    }).start(cb);
  };

  useEffect(() => {
    if (phase === "idle") {
      animateSheet(SHEET_HIDDEN_Y);
    } else if (phase === "submitting" || phase === "success" || phase === "offline") {
      animateSheet(SHEET_COLLAPSED_Y);
    } else if (phase === "details") {
      animateSheet(SHEET_EXPANDED_Y);
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const sheetPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
      onPanResponderGrant: () => {
        sheetDrag.setValue(0);
      },
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) sheetDrag.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        const currentBase = (sheetBase as unknown as { _value: number })._value;
        const projected = currentBase + g.dy + g.vy * 60;

        if (projected > SHEET_HEIGHT * 0.55) {
          Animated.timing(sheetDrag, { toValue: 0, duration: 80, useNativeDriver: true }).start();
          animateSheet(SHEET_HIDDEN_Y, () => {
            setTimeout(() => reset(), 50);
          });
        } else if (projected > SHEET_HEIGHT * 0.25) {
          Animated.timing(sheetDrag, { toValue: 0, duration: 80, useNativeDriver: true }).start();
          animateSheet(SHEET_COLLAPSED_Y);
        } else {
          Animated.timing(sheetDrag, { toValue: 0, duration: 80, useNativeDriver: true }).start();
          animateSheet(SHEET_EXPANDED_Y);
        }
      },
    }),
  ).current;

  const sheetTranslateY = Animated.add(sheetBase, sheetDrag).interpolate({
    inputRange: [SHEET_EXPANDED_Y, SHEET_HIDDEN_Y],
    outputRange: [SHEET_EXPANDED_Y, SHEET_HIDDEN_Y],
    extrapolate: "clamp",
  });

  const pickPhoto = async (useCamera: boolean) => {
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: true })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: true, mediaTypes: ["images"] });

    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handleSubmitDetails = async () => {
    if (!incidentId || isSubmittingDetails.current) return;
    isSubmittingDetails.current = true;
    Keyboard.dismiss();

    try {
      let photoUrl: string | undefined;
      if (photoUri) {
        try {
          photoUrl = await uploadIncidentPhoto(incidentId, photoUri);
        } catch {
          // non-fatal: submit without photo
        }
      }

      await updateIncident(incidentId, {
        type: incidentType ?? "other",
        peopleAffected,
        description,
        photoUrl,
      });

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      animateSheet(SHEET_HIDDEN_Y, () => {
        setTimeout(() => reset(), 50);
      });
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      isSubmittingDetails.current = false;
    }
  };

  const handleAddDetails = () => {
    setPhase("details");
  };

  const handleDismiss = () => {
    animateSheet(SHEET_HIDDEN_Y, () => {
      setTimeout(() => reset(), 50);
    });
  };

  if (phase === "idle") return null;

  return (
    <Animated.View
      style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}
    >
      <OfflineBanner visible={phase === "offline"} />

      <View {...sheetPanResponder.panHandlers} style={styles.dragZone}>
        <View style={styles.handle} />
      </View>

      {phase === "submitting" && (
        <View style={styles.submittingContainer}>
          <LoadingDots />
          <Text style={styles.submittingTitle}>Reporting incident…</Text>
          <Text style={styles.submittingSubtitle}>Getting your location and alerting responders</Text>
        </View>
      )}

      {(phase === "success" || phase === "offline") && (
        <ScrollView
          style={styles.scrollBody}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.successHeader}>
            <Checkmark visible />
            <Text style={styles.successTitle}>
              {phase === "offline" ? "Incident Saved" : "Incident Reported"}
            </Text>
            <Text style={styles.successSubtitle}>
              {phase === "offline"
                ? "Report saved locally. Connect to internet to send."
                : "Responders have been alerted to your location"}
            </Text>
          </View>

          {nearbyParamedics.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>NEAREST RESPONDERS</Text>
              {nearbyParamedics.map((p) => (
                <ParamedicRow key={p.id} paramedic={p} />
              ))}
            </View>
          )}

          {phase === "success" && (
            <Pressable style={styles.addDetailsBtn} onPress={handleAddDetails}>
              <Text style={styles.addDetailsBtnText}>Add Details →</Text>
            </Pressable>
          )}

          <Pressable style={styles.dismissLink} onPress={handleDismiss}>
            <Text style={styles.dismissLinkText}>Dismiss</Text>
          </Pressable>
        </ScrollView>
      )}

      {phase === "details" && (
        <ScrollView
          style={styles.scrollBody}
          contentContainerStyle={[styles.scrollContent, styles.detailsContent]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.detailsTitle}>Incident Details</Text>
          <Text style={styles.detailsSubtitle}>Help responders prepare — every detail matters</Text>

          <Text style={styles.fieldLabel}>TYPE OF INCIDENT</Text>
          <TypeChipGrid />

          <Text style={styles.fieldLabel}>PEOPLE AFFECTED</Text>
          <PeopleCounter />

          <Text style={styles.fieldLabel}>DESCRIPTION</Text>
          <TextInput
            style={styles.descriptionInput}
            multiline
            numberOfLines={4}
            placeholder="What happened? Any relevant details…"
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
                <Pressable onPress={() => setPhotoUri(null)}>
                  <Text style={styles.photoRemove}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.photoRow}>
              <Pressable style={styles.photoBtn} onPress={() => pickPhoto(true)}>
                <Text style={styles.photoBtnIcon}>📷</Text>
                <Text style={styles.photoBtnLabel}>Camera</Text>
              </Pressable>
              <Pressable style={styles.photoBtn} onPress={() => pickPhoto(false)}>
                <Text style={styles.photoBtnIcon}>🖼️</Text>
                <Text style={styles.photoBtnLabel}>Gallery</Text>
              </Pressable>
            </View>
          )}

          <Pressable style={styles.submitBtn} onPress={handleSubmitDetails}>
            <Text style={styles.submitBtnText}>Send Report</Text>
          </Pressable>

          <Pressable style={styles.dismissLink} onPress={handleDismiss}>
            <Text style={styles.dismissLinkText}>Skip & Dismiss</Text>
          </Pressable>
        </ScrollView>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: BOTTOM_MENU_HEIGHT,
    height: SHEET_HEIGHT,
    backgroundColor: "#090f1d",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    zIndex: 29,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 20,
  },

  offlineBanner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: "#92400E",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 12,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  offlineBannerIcon: { fontSize: 20 },
  offlineBannerTitle: { color: "#FDE68A", fontSize: 13, fontWeight: "800", letterSpacing: 0.2 },
  offlineBannerSub: { color: "#FCD34D", fontSize: 11, fontWeight: "500", marginTop: 1 },

  dragZone: {
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(177, 199, 224, 0.28)",
  },

  submittingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 80,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#FF3B3B",
  },
  submittingTitle: {
    color: "#EFF6FF",
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  submittingSubtitle: {
    color: "#6B7F9A",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    paddingHorizontal: 32,
  },

  scrollBody: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 32 },
  detailsContent: { paddingTop: 4 },

  successHeader: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 24,
  },
  checkmarkWrap: {
    marginBottom: 16,
  },
  checkmarkCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "rgba(0, 195, 122, 0.15)",
    borderWidth: 2.5,
    borderColor: "#00C37A",
    alignItems: "center",
    justifyContent: "center",
  },
  checkmarkShort: {
    position: "absolute",
    width: 11,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#00C37A",
    transform: [{ rotate: "45deg" }, { translateX: -5 }, { translateY: 4 }],
  },
  checkmarkLong: {
    position: "absolute",
    width: 22,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#00C37A",
    transform: [{ rotate: "-45deg" }, { translateX: 4 }, { translateY: -1 }],
  },
  successTitle: {
    color: "#EFF6FF",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0.2,
    marginBottom: 6,
  },
  successSubtitle: {
    color: "#6B7F9A",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    paddingHorizontal: 24,
  },

  section: { marginBottom: 20 },
  sectionLabel: {
    color: "#4A5F7A",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 10,
  },

  paramedicRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#101d32",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.1)",
  },
  paramedicAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1e3a5f",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(177, 199, 224, 0.2)",
  },
  paramedicAvatarText: { color: "#93C5FD", fontSize: 13, fontWeight: "800" },
  paramedicInfo: { flex: 1 },
  paramedicName: { color: "#EFF6FF", fontSize: 14, fontWeight: "700" },
  paramedicVehicle: { color: "#6B7F9A", fontSize: 12, fontWeight: "500", marginTop: 2 },
  paramedicDistanceBadge: {
    backgroundColor: "rgba(255, 59, 59, 0.15)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(255, 59, 59, 0.3)",
  },
  paramedicDistanceText: { color: "#FF6B6B", fontSize: 12, fontWeight: "800" },

  addDetailsBtn: {
    backgroundColor: "#FF3B3B",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
    shadowColor: "#FF3B3B",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  addDetailsBtnText: { color: "#fff", fontSize: 15, fontWeight: "900", letterSpacing: 0.3 },

  dismissLink: { alignItems: "center", paddingVertical: 14 },
  dismissLinkText: { color: "#4A5F7A", fontSize: 13, fontWeight: "600" },

  detailsTitle: { color: "#EFF6FF", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  detailsSubtitle: { color: "#6B7F9A", fontSize: 13, fontWeight: "500", marginBottom: 22 },

  fieldLabel: {
    color: "#4A5F7A",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 10,
    marginTop: 18,
  },

  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101d32",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderWidth: 1.5,
    borderColor: "rgba(177, 199, 224, 0.12)",
    gap: 4,
    minHeight: 72,
  },
  chipIcon: { fontSize: 22 },
  chipLabel: { color: "#6B7F9A", fontSize: 11, fontWeight: "700", letterSpacing: 0.2, textAlign: "center" },

  counter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101d32",
    borderRadius: 16,
    paddingVertical: 16,
    gap: 32,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.1)",
  },
  counterBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#182840",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.15)",
  },
  counterBtnDisabled: { opacity: 0.35 },
  counterBtnText: { color: "#EFF6FF", fontSize: 24, fontWeight: "300", lineHeight: 28 },
  counterNumber: { color: "#EFF6FF", fontSize: 42, fontWeight: "900", textAlign: "center", lineHeight: 46 },
  counterLabel: { color: "#6B7F9A", fontSize: 12, fontWeight: "600", textAlign: "center", marginTop: 2 },

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
    minHeight: 100,
  },

  photoRow: {
    flexDirection: "row",
    gap: 10,
  },
  photoBtn: {
    flex: 1,
    backgroundColor: "#101d32",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.12)",
  },
  photoBtnIcon: { fontSize: 24 },
  photoBtnLabel: { color: "#6B7F9A", fontSize: 12, fontWeight: "700" },

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
  photoThumb: { width: 60, height: 60, borderRadius: 10 },
  photoInfo: { flex: 1 },
  photoFilename: { color: "#EFF6FF", fontSize: 13, fontWeight: "700" },
  photoRemove: { color: "#FF6B6B", fontSize: 12, fontWeight: "600", marginTop: 4 },

  submitBtn: {
    backgroundColor: "#FF3B3B",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 24,
    shadowColor: "#FF3B3B",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  submitBtnText: { color: "#fff", fontSize: 16, fontWeight: "900", letterSpacing: 0.4 },
});
