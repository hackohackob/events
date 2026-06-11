import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GeoJSONSource, Layer, Marker } from "@maplibre/maplibre-react-native";
import { useMapStore } from "../map/map-store";
import { useSessionStore } from "../security/session-store";
import { SURFACE_COLORS } from "./surface";
import { clipRouteAhead, formatDistance, formatDuration } from "./geo";
import type { LngLat } from "./types";

/** "Ant-march" dash sequence — cycling it animates motion along the line. */
const DASH_SEQUENCE: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

/** Below this zoom the per-path ETA blocks are dropped to reduce clutter. */
const ETA_MIN_ZOOM = 12.5;

function lineFeature(coordinates: LngLat[]) {
  return {
    type: "FeatureCollection" as const,
    features: [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } }],
  };
}

function midpoint(geometry: LngLat[]): [number, number] {
  const c = geometry[Math.floor(geometry.length / 2)] ?? geometry[0];
  return [c[0], c[1]];
}

function hasFiniteGeometry(geometry: LngLat[]): boolean {
  return geometry.every((c) => Number.isFinite(c?.[0]) && Number.isFinite(c?.[1]));
}

/**
 * Draws every medic's active navigation path for the whole team — colour-coded
 * by surface, with a flowing dash and a minutes-first ETA block. The already
 * covered part of the path is hidden (clipped to what's ahead of the medic),
 * and the remaining distance/ETA are recomputed live from the medic's position,
 * so they stay current on every device as the medic moves. Self is skipped.
 */
export function MedicRoutesLayer({ zoom, dimmed = false }: { zoom: number; dimmed?: boolean }) {
  const markers = useMapStore((s) => s.markers);
  const myId = useSessionStore((s) => s.userId);
  const [dashIndex, setDashIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setDashIndex((i) => (i + 1) % DASH_SEQUENCE.length), 130);
    return () => clearInterval(timer);
  }, []);

  const medicRoutes = markers.filter(
    (m) => m.type === "paramedic" && m.id !== myId && m.route && m.route.geometry.length >= 2 && hasFiniteGeometry(m.route.geometry),
  );
  if (medicRoutes.length === 0) return null;

  // Dimmed (I'm focused on my own incident): faint static lines, no ETA blocks.
  const showEta = zoom >= ETA_MIN_ZOOM && !dimmed;
  const outlineOpacity = dimmed ? 0.4 : 1;
  const segmentOpacity = dimmed ? 0.45 : 0.92;

  return (
    <>
      {medicRoutes.map((medic) => {
        const route = medic.route!;
        // Clip to the part still ahead of the medic + live remaining time/distance.
        const clip = clipRouteAhead(route.geometry, route.segments, { lat: medic.lat, lng: medic.lng });
        const remainingMs = route.durationMs * clip.fraction;
        const eta = new Date(Date.now() + remainingMs);
        const etaClock = `${String(eta.getHours()).padStart(2, "0")}:${String(eta.getMinutes()).padStart(2, "0")}`;
        return (
          <React.Fragment key={`mroute-${medic.id}`}>
            <GeoJSONSource id={`mroute-outline-${medic.id}`} data={lineFeature(clip.geometry)}>
              <Layer
                id={`mroute-outline-layer-${medic.id}`}
                type="line"
                layout={{ "line-join": "round", "line-cap": "round" }}
                paint={{ "line-color": "rgba(8,15,28,0.85)", "line-width": 7, "line-opacity": outlineOpacity }}
              />
            </GeoJSONSource>
            {clip.segments.map((segment, index) => (
              <GeoJSONSource key={`mseg-${medic.id}-${index}`} id={`mseg-${medic.id}-${index}`} data={lineFeature(segment.coordinates)}>
                <Layer
                  id={`mseg-layer-${medic.id}-${index}`}
                  type="line"
                  layout={{ "line-join": "round", "line-cap": "round" }}
                  paint={{ "line-color": SURFACE_COLORS[segment.surface], "line-width": 4.5, "line-opacity": segmentOpacity }}
                />
              </GeoJSONSource>
            ))}
            {!dimmed ? (
              <GeoJSONSource id={`mflow-${medic.id}`} data={lineFeature(clip.geometry)}>
                <Layer
                  id={`mflow-layer-${medic.id}`}
                  type="line"
                  layout={{ "line-join": "round", "line-cap": "round" }}
                  paint={{
                    "line-color": "rgba(255,255,255,0.9)",
                    "line-width": 2.4,
                    "line-dasharray": DASH_SEQUENCE[dashIndex],
                  }}
                />
              </GeoJSONSource>
            ) : null}
            {showEta ? (
              <Marker id={`meta-${medic.id}`} lngLat={midpoint(clip.geometry)}>
                <View style={styles.etaBlock}>
                  <Text style={styles.etaMins}>{formatDuration(remainingMs)}</Text>
                  <Text style={styles.etaClock}>ETA {etaClock}</Text>
                  <Text style={styles.etaDistance}>{formatDistance(clip.remainingMeters)}</Text>
                </View>
              </Marker>
            ) : null}
          </React.Fragment>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  etaBlock: {
    backgroundColor: "rgba(9,14,24,0.96)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.6)",
    paddingVertical: 6,
    paddingHorizontal: 11,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 3 },
    elevation: 9,
  },
  // Minutes-to-arrival is the most important number → biggest.
  etaMins: { color: "#FFFFFF", fontSize: 17, fontWeight: "900", letterSpacing: 0.2, lineHeight: 19 },
  etaClock: { color: "#93c5fd", fontSize: 11.5, fontWeight: "800", marginTop: 1 },
  etaDistance: { color: "#7d8ea4", fontSize: 10, fontWeight: "700", marginTop: 1 },
});
