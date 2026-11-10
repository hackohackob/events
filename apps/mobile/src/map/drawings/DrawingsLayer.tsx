import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GeoJSONSource, Layer, Marker } from "@maplibre/maplibre-react-native";
import { longestLine, midpointAlong, formatDistance, type LngLat } from "./drawing-geometry";
import { shownDrawings, useDrawingsStore } from "./drawings-store";

/** Dark outline under every line, so it reads on streets, satellite and terrain alike. */
const CASING = "#0b1220";

/** Labels would pile up over a whole-event view; they appear once you're close. */
const LABEL_MIN_ZOOM = 10.5;

/** Thinner from far out, fuller up close — typed as the literal tuple MapLibre's style spec wants. */
const lineWidth = (base: number) =>
  ["interpolate", ["linear"], ["zoom"], 9, base * 0.55, 13, base, 17, base * 1.4] as [
    "interpolate",
    ["linear"],
    ["zoom"],
    ...number[],
  ];

/**
 * Team drawings made on the dashboard: ways round hard sections, arrows, lines
 * not to cross. Read-only here — the app never edits them.
 *
 * The source and its layers stay mounted permanently (with an empty collection
 * when there is nothing to show), exactly like ZonesLayer and for the same
 * reason: mounting and unmounting GL sources as data comes and goes crashes the
 * native MapLibre surface.
 */
export function DrawingsLayer({ zoom }: { zoom: number }) {
  const all = useDrawingsStore((s) => s.drawings);
  const enabled = useDrawingsStore((s) => s.enabled);
  const hidden = useDrawingsStore((s) => s.hidden);
  const drawings = useMemo(() => shownDrawings(all, enabled, hidden), [all, enabled, hidden]);

  const collection = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: drawings.map((drawing) => ({
        type: "Feature" as const,
        properties: { color: drawing.color, dashed: drawing.dashed === true },
        geometry: { type: "MultiLineString" as const, coordinates: drawing.lines },
      })),
    }),
    [drawings],
  );

  const labels = useMemo(
    () =>
      drawings
        .filter((d) => d.name)
        .map((drawing) => ({ drawing, at: midpointAlong(longestLine(drawing.lines as LngLat[][])) })),
    [drawings],
  );

  return (
    <>
      <GeoJSONSource id="team-drawings-source" data={collection}>
        <Layer
          id="team-drawings-casing"
          type="line"
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": CASING, "line-width": lineWidth(7.5), "line-opacity": 0.85 }}
        />
        <Layer
          id="team-drawings-solid"
          type="line"
          filter={["==", ["get", "dashed"], false]}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": ["get", "color"], "line-width": lineWidth(4) }}
        />
        {/* Dashed lines keep a faint continuous bed so the gaps never read as breaks. */}
        <Layer
          id="team-drawings-dashed-bed"
          type="line"
          filter={["==", ["get", "dashed"], true]}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": ["get", "color"], "line-width": lineWidth(4), "line-opacity": 0.28 }}
        />
        <Layer
          id="team-drawings-dashed"
          type="line"
          filter={["==", ["get", "dashed"], true]}
          layout={{ "line-cap": "butt", "line-join": "round" }}
          paint={{ "line-color": ["get", "color"], "line-width": lineWidth(4), "line-dasharray": [1.7, 1.3] }}
        />
      </GeoJSONSource>

      {zoom >= LABEL_MIN_ZOOM
        ? labels.map(({ drawing, at }) => (
            <Marker key={`drawing-label-${drawing.id}`} lngLat={at} pointerEvents="none">
              <View style={[styles.label, { borderColor: `${drawing.color}88` }]} pointerEvents="none">
                <View style={[styles.dot, { backgroundColor: drawing.color }]} />
                <Text style={styles.labelText} numberOfLines={1}>
                  {drawing.name}
                </Text>
                {drawing.snapped ? <Text style={styles.distance}>{formatDistance(drawing.distanceMeters)}</Text> : null}
              </View>
            </Marker>
          ))
        : null}
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(6, 12, 24, 0.88)",
    borderRadius: 999,
    borderWidth: 1,
    paddingLeft: 6,
    paddingRight: 9,
    paddingVertical: 3,
    maxWidth: 220,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  labelText: { color: "#f1f5f9", fontSize: 11, fontWeight: "800", flexShrink: 1 },
  distance: { color: "#94a3b8", fontSize: 10, fontWeight: "700" },
});
