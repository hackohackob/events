import React, { useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Camera, Layer, Map as MapLibreMap, RasterSource, UserLocation } from "@maplibre/maplibre-react-native";

/**
 * Map gesture bake-off.
 *
 * Three maps, identical except for the one thing being tested, stacked so the
 * same finger can try all of them in ten seconds. Whichever ones move tell us
 * which configuration this device is happy with — which is a fact, unlike the
 * theory that produced 6.1.1.
 *
 * Deliberately NOT inside a ScrollView: a scrollable ancestor takes the drag at
 * touch slop and every map would look broken (the mistake that made the first
 * touch test unreadable).
 */

/** No API key, and the imagery changes enough that movement is obvious. */
const TEST_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const EMPTY_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "bg", type: "background" as const, paint: { "background-color": "#0b172a" } }],
};

const START = { center: [23.32, 42.7] as [number, number], zoom: 11 };

type MapProps = Partial<React.ComponentProps<typeof MapLibreMap>>;

/** Every map carries the 6.1.1 gesture props; they are not what is in question. */
const GESTURES: MapProps = { dragPan: true, touchZoom: true, doubleTapZoom: true };

/**
 * One variable each, so a result points somewhere.
 *
 *  1 is the control: a map with none of the real screen's overlays, sheets or
 *    cameras on top of it. If even this will not pan, the problem is below us —
 *    MapLibre or the device — and no amount of layout work will help.
 *  2 adds only the follow-camera the real screen runs. MapLibre is supposed to
 *    drop tracking the moment you pan, but MLRNCamera's onCameraTrackingDismissed
 *    is an empty method — so if tracking survives a pan here, every GPS tick
 *    drags the camera back and the map looks frozen while working perfectly.
 *  3 swaps Android's render path. SurfaceView vs TextureView is the one
 *    device-specific difference that costs a single prop to rule out.
 */
const VARIANTS: Array<{ key: string; label: string; hint: string; track?: boolean; props: MapProps }> = [
  {
    key: "plain",
    label: "1 · Plain map",
    hint: "control — nothing on top of it",
    props: GESTURES,
  },
  {
    key: "follow",
    label: "2 · Follow camera",
    hint: "same, plus the real screen's trackUserLocation",
    track: true,
    props: GESTURES,
  },
  {
    key: "texture",
    label: "3 · TextureView",
    hint: "same as 1 on Android's other render path",
    props: { ...GESTURES, androidView: "texture" },
  },
];

export function MapTestScreen({ onClose }: { onClose?: () => void }) {
  // One counter per map. `moves` is the honest signal — if it climbs, that map
  // moved, whether or not the tiles ever loaded.
  const [stats, setStats] = useState<Record<string, { moves: number; zoom: number }>>({});

  const bump = (key: string, event: any) => {
    const props = event?.nativeEvent ?? event?.properties ?? {};
    const zoom = props.zoom ?? props.zoomLevel;
    setStats((s) => ({
      ...s,
      [key]: {
        moves: (s[key]?.moves ?? 0) + 1,
        zoom: typeof zoom === "number" && Number.isFinite(zoom) ? zoom : (s[key]?.zoom ?? START.zoom),
      },
    }));
  };

  const share = async () => {
    await Share.share({
      message:
        "Map test\n" +
        VARIANTS.map(
          (v) => `${v.label}: moves=${stats[v.key]?.moves ?? 0} zoom=${(stats[v.key]?.zoom ?? START.zoom).toFixed(1)}`,
        ).join("\n"),
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {onClose ? (
          <Pressable style={styles.backBtn} onPress={onClose} hitSlop={10}>
            <Feather name="chevron-left" size={22} color="#cbd5e1" />
          </Pressable>
        ) : null}
        <Text style={styles.heading}>Map test</Text>
        <View style={styles.headerActions}>
          <Pressable style={styles.smallBtn} onPress={() => void share()}>
            <Text style={styles.smallBtnText}>Share</Text>
          </Pressable>
          <Pressable style={styles.smallBtn} onPress={() => setStats({})}>
            <Text style={styles.smallBtnText}>Reset</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.intro}>
        Drag each map with one finger, then pinch with two. Say which of the three move, and
        whether any of them slides back on its own.
      </Text>

      <View style={styles.body}>
        {VARIANTS.map((variant) => {
          const stat = stats[variant.key];
          const moved = (stat?.moves ?? 0) > 0;
          return (
            <View key={variant.key} style={styles.slot}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>{variant.label}</Text>
                <Text style={[styles.stat, moved && styles.statMoved]}>
                  {moved ? `✓ moves ${stat!.moves} · z${stat!.zoom.toFixed(1)}` : "not moved yet"}
                </Text>
              </View>
              <Text style={styles.hint}>{variant.hint}</Text>
              <View style={styles.mapWrap}>
                <MapLibreMap
                  style={StyleSheet.absoluteFill}
                  mapStyle={EMPTY_STYLE}
                  logo={false}
                  attribution={false}
                  compass={false}
                  scaleBar={false}
                  onRegionDidChange={(event: any) => bump(variant.key, event)}
                  {...variant.props}
                >
                  <Camera initialViewState={START} trackUserLocation={variant.track ? "default" : undefined} />
                  {variant.track ? <UserLocation /> : null}
                  <RasterSource id={`src-${variant.key}`} tiles={[TEST_TILES]} tileSize={256} maxzoom={18}>
                    {/* index 1 keeps the imagery above the background layer and
                        below nothing — see maplibre-base-raster-layerindex. */}
                    <Layer id={`layer-${variant.key}`} type="raster" layerIndex={1} />
                  </RasterSource>
                </MapLibreMap>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020b18" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  heading: { color: "#eff6ff", fontSize: 20, fontWeight: "900" },
  headerActions: { flexDirection: "row", gap: 8, marginLeft: "auto" },
  smallBtn: { backgroundColor: "#16263d", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  smallBtnText: { color: "#9fb3cc", fontSize: 12, fontWeight: "700" },
  intro: { color: "#7c8a9c", fontSize: 12, lineHeight: 17, paddingHorizontal: 16, paddingBottom: 8 },
  body: { flex: 1, paddingHorizontal: 12, paddingBottom: 12, gap: 10 },
  slot: { flex: 1 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { color: "#dbe6f3", fontSize: 13, fontWeight: "800" },
  stat: { color: "#5f7da0", fontSize: 11, fontWeight: "700", marginLeft: "auto", fontVariant: ["tabular-nums"] },
  statMoved: { color: "#22ff88" },
  hint: { color: "#5f7da0", fontSize: 10, marginBottom: 4 },
  mapWrap: {
    flex: 1,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    backgroundColor: "#0b172a",
  },
});
