import React, { useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  Marker,
  RasterSource,
} from "@maplibre/maplibre-react-native";
import { fieldAt, medicPositionAt } from "@events/planner";
import { getMapyTilesTemplateUrl } from "../map/mapy-config";
import { baseInitials } from "../map/initials";
import type { MedicPlan, PlanCourse } from "./plan-model";

const FALLBACK_CENTER: [number, number] = [23.3219, 42.6977];

function lineFeature(coordinates: [number, number][]) {
  return {
    type: "FeatureCollection" as const,
    features: [
      { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } },
    ],
  };
}

function pointsFeature(points: [number, number][]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((coordinates, i) => ({
      type: "Feature" as const,
      properties: { i },
      geometry: { type: "Point" as const, coordinates },
    })),
  };
}

/**
 * The planner's map. A deliberately plain one: courses, where the field is,
 * where every medic is at the cursor, and the journey the selected medic is on.
 * The coverage and gap analysis stays at the desk — on a phone the question is
 * "where am I meant to be, and who else is out here", not "is this plan sound".
 */
export function PlanMap({
  courses,
  medicPlans,
  cursorMs,
  selectedMedicId,
  editing,
  onSelectMedic,
  onMapPress,
}: {
  courses: PlanCourse[];
  medicPlans: MedicPlan[];
  cursorMs: number;
  selectedMedicId: string | null;
  editing: boolean;
  onSelectMedic: (planMedicId: string) => void;
  onMapPress: (lngLat: [number, number]) => void;
}) {
  const cameraRef = useRef<CameraRef>(null);
  const framed = useRef(false);
  const tilesUrl = getMapyTilesTemplateUrl() ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileSize = getMapyTilesTemplateUrl() ? 512 : 256;

  const liveCourses = useMemo(() => courses.filter((c) => c.enabled && c.hasCourse), [courses]);

  // Frame the whole deployment once, the first time there is anything to frame.
  useEffect(() => {
    if (framed.current || liveCourses.length === 0) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const c of liveCourses) {
      for (const [lng, lat] of c.course.coordinates) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }
    if (!Number.isFinite(minLng)) return;
    framed.current = true;
    cameraRef.current?.fitBounds([minLng, minLat, maxLng, maxLat], {
      padding: { top: 90, right: 40, bottom: 260, left: 40 },
      duration: 600,
    });
  }, [liveCourses]);

  /** Where the field is, per course, at the cursor. */
  const fields = useMemo(
    () =>
      liveCourses.map((c) => ({
        id: c.id,
        color: c.color,
        state: fieldAt(c.schedule, c.shape, c.course, cursorMs),
      })),
    [liveCourses, cursorMs],
  );

  const positions = useMemo(
    () =>
      medicPlans
        .map(({ medic, timeline, sweeps }) => ({
          medic,
          position: medicPositionAt(timeline, cursorMs, sweeps),
        }))
        .filter((p): p is { medic: (typeof medicPlans)[number]["medic"]; position: NonNullable<ReturnType<typeof medicPositionAt>> } =>
          p.position != null,
        ),
    [medicPlans, cursorMs],
  );

  const selected = positions.find((p) => p.medic.id === selectedMedicId);
  const selectedStations = useMemo(() => {
    const plan = medicPlans.find((m) => m.medic.id === selectedMedicId);
    return plan?.timeline.stations ?? [];
  }, [medicPlans, selectedMedicId]);

  return (
    <MapLibreMap
      style={styles.map}
      mapStyle={{
        version: 8,
        sources: {},
        layers: [{ id: "base-bg", type: "background", paint: { "background-color": "#051325" } }],
      }}
      logo={false}
      attribution={false}
      compass={false}
      scaleBar={false}
      onPress={(event: any) => {
        const lngLat = event?.nativeEvent?.lngLat;
        if (Array.isArray(lngLat) && lngLat.length >= 2) onMapPress([lngLat[0], lngLat[1]]);
      }}
    >
      <Camera ref={cameraRef} initialViewState={{ center: FALLBACK_CENTER, zoom: 9 }} />

      <RasterSource id="plan-base-source" tiles={[tilesUrl]} maxzoom={19} tileSize={tileSize}>
        {/* Index 1 pins the imagery just above the style's background and under
            every overlay. Index 0 would displace the background and blank the
            map — see the main map screen for the full story. */}
        <Layer id="plan-base-layer" type="raster" layerIndex={1} paint={{ "raster-opacity": 0.85 }} />
      </RasterSource>

      {/* Courses. */}
      {liveCourses.map((c) => (
        <GeoJSONSource key={`course-${c.id}`} id={`course-src-${c.id}`} data={lineFeature(c.course.coordinates)}>
          <Layer
            id={`course-glow-${c.id}`}
            type="line"
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={{ "line-color": c.color, "line-width": 12, "line-blur": 10, "line-opacity": 0.35 }}
          />
          <Layer
            id={`course-line-${c.id}`}
            type="line"
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={{ "line-color": c.color, "line-width": 3.2, "line-opacity": 0.95 }}
          />
        </GeoJSONSource>
      ))}

      {/* The field, as thinned dots. Small on purpose: bunched at the gun they
          would otherwise hide the course underneath them. */}
      {fields.map((f) =>
        f.state.dots.length > 0 ? (
          <GeoJSONSource key={`field-${f.id}`} id={`field-src-${f.id}`} data={pointsFeature(f.state.dots)}>
            <Layer
              id={`field-dots-${f.id}`}
              type="circle"
              paint={{
                "circle-radius": 2.4,
                "circle-color": "#f8fafc",
                "circle-opacity": 0.85,
                "circle-stroke-width": 0.6,
                "circle-stroke-color": f.color,
              }}
            />
          </GeoJSONSource>
        ) : null,
      )}

      {/* The selected medic's journey, drawn only while they are on it. */}
      {selected?.position.path && selected.position.path.length > 1 ? (
        <GeoJSONSource id="plan-journey-src" data={lineFeature(selected.position.path)}>
          <Layer
            id="plan-journey"
            type="line"
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={{
              "line-color": selected.medic.color,
              "line-width": 3,
              "line-opacity": 0.9,
              "line-dasharray": [2, 1.6],
            }}
          />
        </GeoJSONSource>
      ) : null}

      {/* The selected medic's postings, so a plan can be read as a route. */}
      {selectedStations.map((station, i) => (
        <Marker key={`station-${station.id}`} lngLat={[station.lng, station.lat]} pointerEvents="none">
          <View style={[styles.stationPin, editing && styles.stationPinEditing]} pointerEvents="none">
            <Text style={styles.stationPinText} allowFontScaling={false}>
              {i + 1}
            </Text>
          </View>
        </Marker>
      ))}

      {/* Medics at the cursor. */}
      {positions.map(({ medic, position }) => {
        const off = position.phase === "off-duty";
        return (
          <Marker key={`medic-${medic.id}`} lngLat={position.position}>
            <Pressable
              style={[
                styles.medicPin,
                { backgroundColor: medic.color, opacity: off ? 0.35 : 1 },
                medic.id === selectedMedicId && styles.medicPinSelected,
              ]}
              onPress={() => onSelectMedic(medic.id)}
              hitSlop={6}
            >
              <Text style={styles.medicPinText} allowFontScaling={false}>
                {baseInitials(medic.name)}
              </Text>
              {position.phase === "moving" ? <View style={styles.movingDot} /> : null}
              {position.phase === "sweeping" ? (
                <Text style={styles.sweepBadge} allowFontScaling={false}>
                  🧹
                </Text>
              ) : null}
            </Pressable>
          </Marker>
        );
      })}
    </MapLibreMap>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  medicPin: {
    minWidth: 30,
    height: 30,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(4,18,31,0.85)",
  },
  medicPinSelected: { borderColor: "#f8fafc", borderWidth: 2.5 },
  medicPinText: { color: "#04121f", fontSize: 12, fontWeight: "900" },
  movingDot: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#f59e0b",
    borderWidth: 1,
    borderColor: "#04121f",
  },
  sweepBadge: { position: "absolute", bottom: -9, fontSize: 11 },
  stationPin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(8,15,28,0.9)",
    borderWidth: 1.5,
    borderColor: "rgba(226,232,240,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  stationPinEditing: { borderColor: "#f59e0b", backgroundColor: "rgba(31,22,6,0.95)" },
  stationPinText: { color: "#e2e8f0", fontSize: 9, fontWeight: "900" },
});
