import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { GeoJSONSource, Layer, Marker } from "@maplibre/maplibre-react-native";
import { closestMedicColor, VEHICLE_TYPE_META, type ClosestMedic } from "@events/contracts";
import type { LngLat } from "./types";

function lineFeature(coordinates: LngLat[]) {
  return {
    type: "FeatureCollection" as const,
    features: [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } }],
  };
}

function hasFiniteGeometry(geometry: LngLat[]): boolean {
  return geometry.every((c) => Number.isFinite(c?.[0]) && Number.isFinite(c?.[1]));
}

function minutes(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60000));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`;
}

/**
 * The five candidate routes from the "closest medic" search, one colour per
 * medic — green for the fastest through to red for the slowest, matching the
 * stripe on that medic's card in the drawer.
 *
 * These are deliberately drawn flat (no surface colouring, no ant-march): they
 * are five hypotheses shown at once, and the only thing the eye needs to
 * separate them is hue. Surface detail is for the one route that gets picked.
 */
export function ClosestMedicRoutesLayer({
  medics,
  selectedMedicId,
}: {
  medics: ClosestMedic[];
  selectedMedicId?: string | null;
}) {
  if (medics.length === 0) return null;

  // Draw order is paint order: slowest first, so the fastest route sits on top
  // of the ones it crosses.
  const ordered = [...medics].sort((a, b) => b.rank - a.rank);

  // The selected route is redrawn afterwards in its own always-last pass. It
  // cannot just be reordered into `ordered`: reshuffling React children does not
  // reliably restack the underlying native layers, so a slow (red) route stayed
  // buried under the greener ones exactly when you asked to inspect it. Painting
  // it a second time is cheap and always wins.
  const selected = selectedMedicId
    ? medics.find(
        (m) =>
          m.medicId === selectedMedicId &&
          !m.direct &&
          (m.route?.geometry?.length ?? 0) >= 2 &&
          hasFiniteGeometry(m.route!.geometry as LngLat[]),
      )
    : undefined;

  return (
    <>
      {ordered.map((medic) => {
        const geometry = (medic.route?.geometry ?? []) as LngLat[];
        // Unroutable medics get a straight line to the incident instead — drawn
        // dashed, because it is an estimate rather than a way anyone can follow.
        const isDirect = medic.direct || geometry.length < 2 || !hasFiniteGeometry(geometry);
        if (isDirect) return null;
        // The selected route is painted by the always-last highlight pass below.
        if (selected?.medicId === medic.medicId) return null;

        const color = closestMedicColor(medic.rank);
        const dimmed = selectedMedicId != null;
        const width = 4;

        return (
          <React.Fragment key={`cm-${medic.medicId}`}>
            <GeoJSONSource id={`cm-outline-${medic.medicId}`} data={lineFeature(geometry)}>
              <Layer
                id={`cm-outline-layer-${medic.medicId}`}
                type="line"
                layout={{ "line-join": "round", "line-cap": "round" }}
                paint={{
                  "line-color": "rgba(6,12,22,0.9)",
                  "line-width": width + 3,
                  "line-opacity": dimmed ? 0.35 : 0.9,
                }}
              />
            </GeoJSONSource>
            <GeoJSONSource id={`cm-line-${medic.medicId}`} data={lineFeature(geometry)}>
              <Layer
                id={`cm-line-layer-${medic.medicId}`}
                type="line"
                layout={{ "line-join": "round", "line-cap": "round" }}
                paint={{ "line-color": color, "line-width": width, "line-opacity": dimmed ? 0.32 : 1 }}
              />
            </GeoJSONSource>
          </React.Fragment>
        );
      })}

      {/* Selected route, redrawn last so it is unambiguously on top. */}
      {selected ? (
        <React.Fragment key={`cm-sel-${selected.medicId}`}>
          <GeoJSONSource id="cm-selected-outline" data={lineFeature(selected.route!.geometry as LngLat[])}>
            <Layer
              id="cm-selected-outline-layer"
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{ "line-color": "rgba(6,12,22,0.95)", "line-width": 10 }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="cm-selected-line" data={lineFeature(selected.route!.geometry as LngLat[])}>
            <Layer
              id="cm-selected-line-layer"
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{ "line-color": closestMedicColor(selected.rank), "line-width": 6.5 }}
            />
          </GeoJSONSource>
        </React.Fragment>
      ) : null}

      {/* One tag per medic at their own position: rank colour, vehicle, ETA. */}
      {medics.map((medic) => {
        if (!Number.isFinite(medic.lat) || !Number.isFinite(medic.lng)) return null;
        const color = closestMedicColor(medic.rank);
        const dimmed = selectedMedicId != null && selectedMedicId !== medic.medicId;
        return (
          <Marker key={`cm-tag-${medic.medicId}`} id={`cm-tag-${medic.medicId}`} lngLat={[medic.lng, medic.lat]}>
            <View style={[styles.tag, { borderColor: color }, dimmed && styles.tagDimmed]} pointerEvents="none">
              <Text style={styles.tagGlyph} allowFontScaling={false}>
                {VEHICLE_TYPE_META[medic.vehicleType].icon}
              </Text>
              <Text style={[styles.tagEta, { color }]} allowFontScaling={false}>
                {minutes(medic.durationMs)}
              </Text>
              {medic.direct ? (
                <Text style={styles.tagDirect} allowFontScaling={false}>~</Text>
              ) : null}
            </View>
          </Marker>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(9,14,24,0.96)",
    borderRadius: 11,
    borderWidth: 1.5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
    elevation: 8,
  },
  tagDimmed: { opacity: 0.5 },
  tagGlyph: { fontSize: 12, lineHeight: 15, includeFontPadding: false },
  tagEta: { fontSize: 13, fontWeight: "900", includeFontPadding: false },
  // "~" marks an estimate rather than a routed time.
  tagDirect: { color: "#fbbf24", fontSize: 12, fontWeight: "900" },
});
