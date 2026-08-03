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
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { updatePoi, type PoiDto } from "../ui/event-actions";
import { PoiIcon, CUSTOM_POI_ICON_OPTIONS } from "./poi-icons";
import { POI_TYPES } from "./poi-types";
import { debugLog } from "../debug/debug-log";

/** The point being edited, as the map already knows it. */
export interface EditablePoi {
  id: string;
  type?: string;
  name?: string;
  description?: string;
  icon?: string;
  lat: number;
  lng: number;
}

interface Props {
  poi: EditablePoi | null;
  onClose: () => void;
  onSaved: (poi: PoiDto) => void;
}

/**
 * Coordinator-only editor for an existing point: retype it, rename it, swap the
 * custom glyph, or rewrite the note. Moving and archiving stay on the marker
 * sheet — those are one-tap actions, not a form.
 */
export function EditPoiSheet({ poi, onClose, onSaved }: Props) {
  const [type, setType] = useState("medical-point");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [customIcon, setCustomIcon] = useState(CUSTOM_POI_ICON_OPTIONS[0].key);
  const [iconOpen, setIconOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reload the form from the point each time the sheet opens on a new one.
  useEffect(() => {
    if (!poi) return;
    // A type the picker doesn't offer (placed on the dashboard) still has to be
    // editable, so keep it selected rather than silently retyping the point.
    setType(poi.type || "medical-point");
    setName(poi.name ?? "");
    setDescription(poi.description ?? "");
    setCustomIcon(
      CUSTOM_POI_ICON_OPTIONS.find((o) => o.key === poi.icon)?.key ?? CUSTOM_POI_ICON_OPTIONS[0].key,
    );
    setIconOpen(false);
    setSaving(false);
  }, [poi]);

  const selectedIcon =
    CUSTOM_POI_ICON_OPTIONS.find((o) => o.key === customIcon) ?? CUSTOM_POI_ICON_OPTIONS[0];
  // Types outside the picker get their own chip so the selection stays visible.
  const typeOptions = POI_TYPES.some((t) => t.id === type)
    ? POI_TYPES
    : [...POI_TYPES, { id: type, label: type.replace(/-/g, " "), icon: "★", color: "#94a3b8" }];

  const submit = async () => {
    if (!poi || saving) return;
    setSaving(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const saved = await updatePoi(poi.id, {
        type,
        name: name.trim(),
        description: description.trim(),
        // Clear the glyph when the point is no longer a custom one, so it falls
        // back to its type icon instead of keeping a stale star.
        icon: type === "custom" ? customIcon : "",
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(saved);
    } catch (err) {
      debugLog("api", "error", "update POI failed", String(err));
      setSaving(false);
    }
  };

  return (
    <Modal visible={!!poi} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.centerWrap}
        >
          {/* Stop propagation so taps inside the card don't dismiss. */}
          <Pressable style={styles.card} onPress={() => {}}>
            <View style={styles.grabber} />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.cardScrollContent}
            >
              <Text style={styles.title}>Edit point</Text>
              <Text style={styles.subtitle}>
                {poi ? `${poi.lat.toFixed(5)}, ${poi.lng.toFixed(5)}` : ""}
              </Text>

              <Text style={styles.label}>TYPE</Text>
              <View style={styles.typeRow}>
                {typeOptions.map((t) => {
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
                      <PoiIcon type={t.id} size={15} color={active ? t.color : "#94a3b8"} />
                      <Text style={[styles.typeText, active && { color: t.color }]}>{t.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {type === "custom" && (
                <>
                  <Text style={styles.label}>ICON</Text>
                  <Pressable
                    style={styles.iconSelect}
                    onPress={() => {
                      setIconOpen((o) => !o);
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                  >
                    <MaterialCommunityIcons name={selectedIcon.icon} size={18} color="#34d399" />
                    <Text style={styles.iconSelectText}>{selectedIcon.label}</Text>
                    <MaterialCommunityIcons
                      name={iconOpen ? "chevron-up" : "chevron-down"}
                      size={18}
                      color="#64748b"
                    />
                  </Pressable>
                  {iconOpen && (
                    <View style={styles.iconMenu}>
                      {CUSTOM_POI_ICON_OPTIONS.map((opt) => {
                        const active = opt.key === customIcon;
                        return (
                          <Pressable
                            key={opt.key}
                            style={[styles.iconMenuItem, active && styles.iconMenuItemActive]}
                            onPress={() => {
                              setCustomIcon(opt.key);
                              setIconOpen(false);
                              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            }}
                          >
                            <MaterialCommunityIcons
                              name={opt.icon}
                              size={17}
                              color={active ? "#34d399" : "#94a3b8"}
                            />
                            <Text style={[styles.iconMenuText, active && { color: "#34d399" }]}>{opt.label}</Text>
                            {active && <MaterialCommunityIcons name="check" size={15} color="#34d399" />}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </>
              )}

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

              <Pressable style={[styles.saveBtn, saving && styles.saveBtnDisabled]} onPress={submit} disabled={saving}>
                {saving ? (
                  <ActivityIndicator size="small" color="#04121f" />
                ) : (
                  <Text style={styles.saveBtnText}>Save changes</Text>
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
  typeText: { color: "#94a3b8", fontSize: 12.5, fontWeight: "800" },
  iconSelect: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#101d32",
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(177,199,224,0.12)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  iconSelectText: { flex: 1, color: "#EFF6FF", fontSize: 14, fontWeight: "700" },
  iconMenu: {
    marginTop: 6,
    backgroundColor: "#0c1626",
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(177,199,224,0.14)",
    overflow: "hidden",
  },
  iconMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  iconMenuItemActive: { backgroundColor: "rgba(52,211,153,0.10)" },
  iconMenuText: { flex: 1, color: "#cbd5e1", fontSize: 13.5, fontWeight: "700" },
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
  saveBtn: {
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
  saveBtnDisabled: { backgroundColor: "#1f4f43" },
  saveBtnText: { color: "#04121f", fontSize: 16, fontWeight: "900", letterSpacing: 0.3 },
  cancelBtn: { alignItems: "center", paddingVertical: 13, marginTop: 2 },
  cancelText: { color: "#64748b", fontSize: 13, fontWeight: "700" },
});
