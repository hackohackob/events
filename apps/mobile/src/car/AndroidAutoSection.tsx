import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSettingsStore } from "../settings/settings-store";
import { useMapStore } from "../map/map-store";
import { getMapyTilesTemplateUrl } from "../map/mapy-config";
import { debugLog } from "../debug/debug-log";
import {
  cancelCarTilePrefetch,
  carBridgeAvailable,
  carTileCacheStats,
  clearCarTileCache,
  onCarTilePrefetchProgress,
  prefetchCarTiles,
  type TilePrefetchProgress,
} from "./car-native";

/**
 * Zoom span the car map is pre-downloaded at. The floor keeps the whole event
 * area on screen; the ceiling is the tightest the car ever draws while
 * navigating. Going one zoom deeper would quadruple the download for detail
 * nobody reads at speed.
 */
const CAR_PREFETCH_MIN_ZOOM = 10;
const CAR_PREFETCH_MAX_ZOOM = 15;
/** Padding around the event's own data, so a detour off-course isn't blank. */
const BBOX_PADDING_DEG = 0.05;
/** Observed average for these raster tiles; only used for the size estimate. */
const ESTIMATED_TILE_BYTES = 28_000;

interface Bounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Bounding box over everything the event has put on the map. */
function eventBounds(): Bounds | null {
  const { markers, tracks } = useMapStore.getState();
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;

  const consider = (lat: number, lng: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  };

  for (const track of tracks) for (const point of track.points) consider(point.lat, point.lng);
  for (const marker of markers) consider(marker.lat, marker.lng);
  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null;

  return {
    minLat: minLat - BBOX_PADDING_DEG,
    maxLat: maxLat + BBOX_PADDING_DEG,
    minLng: minLng - BBOX_PADDING_DEG,
    maxLng: maxLng + BBOX_PADDING_DEG,
  };
}

function tileCount(bounds: Bounds): number {
  let total = 0;
  for (let z = CAR_PREFETCH_MIN_ZOOM; z <= CAR_PREFETCH_MAX_ZOOM; z += 1) {
    const scale = 2 ** z;
    const xMin = Math.floor(((bounds.minLng + 180) / 360) * scale);
    const xMax = Math.floor(((bounds.maxLng + 180) / 360) * scale);
    const yMin = Math.floor(latToTileY(bounds.maxLat, scale));
    const yMax = Math.floor(latToTileY(bounds.minLat, scale));
    total += (Math.abs(xMax - xMin) + 1) * (Math.abs(yMax - yMin) + 1);
  }
  return total;
}

function latToTileY(lat: number, scale: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Android Auto settings. The car app draws its own map from raster tiles it
 * caches itself — MapLibre's offline packs live in MapLibre's private store and
 * are not readable from the car renderer — so the car keeps a separate cache,
 * and this is where it gets filled before an event with no coverage.
 */
export function AndroidAutoSection() {
  const androidAutoEnabled = useSettingsStore((s) => s.androidAutoEnabled);
  const setAndroidAutoEnabled = useSettingsStore((s) => s.setAndroidAutoEnabled);
  const [stats, setStats] = useState<{ tiles: number; bytes: number } | null>(null);
  const [progress, setProgress] = useState<TilePrefetchProgress | null>(null);

  const refreshStats = useCallback(() => {
    void carTileCacheStats().then(setStats);
  }, []);

  useEffect(() => {
    refreshStats();
    const sub = onCarTilePrefetchProgress((next) => {
      setProgress(next.finished ? null : next);
      if (next.finished) refreshStats();
    });
    return () => sub?.remove();
  }, [refreshStats]);

  // Android-only feature, and only in a build that actually ships the car app.
  if (Platform.OS !== "android" || !carBridgeAvailable) return null;

  const download = () => {
    const template = getMapyTilesTemplateUrl();
    if (!template) {
      Alert.alert("No map key", "This build has no map tile key, so there is nothing to download.");
      return;
    }
    const bounds = eventBounds();
    if (!bounds) {
      Alert.alert("Nothing to download yet", "Load the event map first — the download covers the event area.");
      return;
    }
    const count = tileCount(bounds);
    Alert.alert(
      "Download map for the car?",
      `About ${count.toLocaleString()} tiles (~${formatBytes(count * ESTIMATED_TILE_BYTES)}) covering the event area, ` +
        `zoom ${CAR_PREFETCH_MIN_ZOOM}–${CAR_PREFETCH_MAX_ZOOM}. Best done on Wi-Fi.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Download",
          onPress: () => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setProgress({ done: 0, total: count, bytes: 0, finished: false });
            void prefetchCarTiles({
              ...bounds,
              minZoom: CAR_PREFETCH_MIN_ZOOM,
              maxZoom: CAR_PREFETCH_MAX_ZOOM,
              tileUrlTemplate: template,
            }).catch((err) => {
              debugLog("app", "error", "car tile prefetch failed", String(err));
              setProgress(null);
              Alert.alert("Download failed", "Could not start the download. Check your connection and try again.");
            });
          },
        },
      ],
    );
  };

  const clear = () => {
    Alert.alert("Clear the car's map cache?", "The car will re-download tiles as you drive.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          void clearCarTileCache().then(refreshStats);
        },
      },
    ]);
  };

  const downloading = progress != null && !progress.finished;

  return (
    <>
      <Text style={styles.sectionLabel}>ANDROID AUTO</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Show on the car screen</Text>
            <Text style={styles.rowSub}>
              Project the map, navigation and incidents onto Android Auto. Turn off to keep the car screen clear
              without touching anything on the phone.
            </Text>
          </View>
          <Switch
            value={androidAutoEnabled}
            onValueChange={(v) => {
              setAndroidAutoEnabled(v);
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            trackColor={{ false: "#1e293b", true: "#16a34a" }}
            thumbColor="#f1f5f9"
          />
        </View>

        <View style={[styles.rowDivider, styles.stack]}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Offline map for the car</Text>
            <Text style={styles.rowSub}>
              The car draws its own map and keeps its own tile cache. Download the event area before you ride out
              of coverage.
              {stats ? ` Currently ${stats.tiles.toLocaleString()} tiles (${formatBytes(stats.bytes)}).` : ""}
            </Text>
          </View>

          {downloading ? (
            <View style={styles.progressRow}>
              <ActivityIndicator size="small" color="#38bdf8" />
              <Text style={styles.progressText}>
                {progress!.done.toLocaleString()} / {progress!.total.toLocaleString()} tiles
                {progress!.bytes > 0 ? ` · ${formatBytes(progress!.bytes)}` : ""}
              </Text>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  cancelCarTilePrefetch();
                  setProgress(null);
                  refreshStats();
                }}
              >
                <Text style={styles.secondaryButtonText}>Stop</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.buttonRow}>
              <Pressable style={styles.primaryButton} onPress={download}>
                <Feather name="download-cloud" size={15} color="#04121f" />
                <Text style={styles.primaryButtonText}>Download for car</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={clear}>
                <Text style={styles.secondaryButtonText}>Clear</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    color: "#7e90a8",
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginTop: 22,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: "rgba(9, 20, 36, 0.95)",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(148, 163, 184, 0.18)",
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(148, 163, 184, 0.16)",
    paddingVertical: 12,
  },
  stack: { gap: 12 },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { color: "#e2e8f0", fontSize: 14.5, fontWeight: "700" },
  rowSub: { color: "#7e90a8", fontSize: 12.5, lineHeight: 17 },
  buttonRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  primaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#38bdf8",
    borderRadius: 10,
    paddingVertical: 11,
  },
  primaryButtonText: { color: "#04121f", fontSize: 13.5, fontWeight: "800" },
  secondaryButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(148, 163, 184, 0.35)",
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: "#cbd5e1", fontSize: 13.5, fontWeight: "700" },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  progressText: { flex: 1, color: "#cbd5e1", fontSize: 12.5, fontWeight: "700" },
});
