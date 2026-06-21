import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GeoJSONSource, Layer, Marker } from "@maplibre/maplibre-react-native";
import { useNavStore } from "./nav-store";
import { useMapStore } from "../map/map-store";
import { NavPuck } from "./NavPuck";
import { SURFACE_COLORS } from "./surface";
import { clipRouteAhead } from "./geo";
import { useSmoothedPosition } from "./useSmoothedPosition";
import type { LngLat } from "./types";

function lineFeature(coordinates: LngLat[]) {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates },
      },
    ],
  };
}

/**
 * MapLibre children that draw the navigation routes. Must be rendered *inside*
 * the `<MapLibreMap>` element. Renders alternatives muted underneath the
 * selected route, which gets a premium glow + white outline + per-surface
 * coloured segments, plus the start/destination/via markers.
 */
export function NavigationMapLayers() {
  const phase = useNavStore((s) => s.phase);
  const routes = useNavStore((s) => s.routes);
  const selectedRouteId = useNavStore((s) => s.selectedRouteId);
  const destination = useNavStore((s) => s.destination);
  const origin = useNavStore((s) => s.origin);
  const vias = useNavStore((s) => s.vias);
  const progress = useNavStore((s) => s.progress);
  const navCameraMode = useNavStore((s) => s.navCameraMode);
  const destinationIncidentId = useNavStore((s) => s.destinationIncidentId);
  const markers = useMapStore((s) => s.markers);

  // Only flash the puck red/blue while navigating to an incident that is still
  // open — once it's resolved/closed/archived the emergency flash stops.
  const respondingToOpenIncident = useMemo(() => {
    if (!destinationIncidentId) return false;
    const incident = markers.find((m) => m.id === destinationIncidentId && m.type === "incident");
    if (!incident) return false;
    const status = incident.status;
    return status !== "resolved" && status !== "closed" && status !== "archived";
  }, [destinationIncidentId, markers]);

  const selected = routes.find((r) => r.id === selectedRouteId) ?? routes[0];
  const alternatives = routes.filter((r) => r.id !== selected?.id);
  const isActive = phase === "active";

  // Glide the puck between GPS fixes (≈1/s) instead of teleporting.
  const smoothedPuck = useSmoothedPosition(isActive ? progress?.snapped : null);

  // During active navigation, hide the part of the route already travelled —
  // the line is drawn from the snapped puck position forward only.
  const displayed = useMemo(() => {
    if (!selected) return null;
    if (!isActive || !progress) return { geometry: selected.geometry, segments: selected.segments };
    return clipRouteAhead(selected.geometry, selected.segments, progress.snapped);
  }, [selected, isActive, progress]);

  if (phase === "idle" || phase === "transport") return null;

  return (
    <>
      {/* Alternatives — muted, thin, no glow, drawn underneath. Hidden in active nav. */}
      {!isActive &&
        alternatives.map((route) => (
          <GeoJSONSource key={`nav-alt-${route.id}`} id={`nav-alt-src-${route.id}`} data={lineFeature(route.geometry)}>
            <Layer
              id={`nav-alt-outline-${route.id}`}
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{ "line-color": "rgba(8,15,28,0.6)", "line-width": 7 }}
            />
            <Layer
              id={`nav-alt-line-${route.id}`}
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{ "line-color": "rgba(148,170,196,0.55)", "line-width": 4 }}
            />
          </GeoJSONSource>
        ))}

      {/* Selected route — glow, white outline, then coloured surface segments. */}
      {selected && displayed ? (
        <React.Fragment key={`nav-sel-${selected.id}`}>
          <GeoJSONSource id="nav-sel-glow-src" data={lineFeature(displayed.geometry)}>
            <Layer
              id="nav-sel-glow"
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{
                "line-color": "rgba(83,160,255,0.55)",
                "line-width": isActive ? 22 : 16,
                "line-blur": 14,
                "line-opacity": 0.7,
              }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="nav-sel-outline-src" data={lineFeature(displayed.geometry)}>
            <Layer
              id="nav-sel-outline"
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{ "line-color": "#FFFFFF", "line-width": isActive ? 13 : 10, "line-opacity": 0.95 }}
            />
          </GeoJSONSource>
          {displayed.segments.map((segment, index) => (
            <GeoJSONSource
              key={`nav-seg-${index}`}
              id={`nav-seg-src-${index}`}
              data={lineFeature(segment.coordinates)}
            >
              <Layer
                id={`nav-seg-${index}`}
                type="line"
                layout={{ "line-join": "round", "line-cap": "round" }}
                paint={{ "line-color": SURFACE_COLORS[segment.surface], "line-width": isActive ? 8.5 : 6.5 }}
              />
            </GeoJSONSource>
          ))}
        </React.Fragment>
      ) : null}

      {/* Start marker (everywhere except active nav, where the puck stands in). */}
      {!isActive && origin ? (
        <Marker id="nav-start-marker" lngLat={[origin.lng, origin.lat]}>
          <View style={[styles.endpoint, styles.startPoint]}>
            <Text style={styles.startGlyph}>▶</Text>
          </View>
        </Marker>
      ) : null}

      {/* Destination marker. */}
      {destination ? (
        <Marker id="nav-dest-marker" lngLat={[destination.lng, destination.lat]}>
          <View style={[styles.endpoint, styles.destPoint]}>
            <Text style={styles.destGlyph}>★</Text>
          </View>
        </Marker>
      ) : null}

      {/* Numbered via markers (route editing). Numbered 2..n-1 to match the list. */}
      {!isActive &&
        vias.map((via, index) => (
          <Marker key={`nav-via-${index}`} id={`nav-via-${index}`} lngLat={[via.lng, via.lat]}>
            <View style={styles.viaMarker}>
              <Text style={styles.viaText}>{index + 2}</Text>
            </View>
          </Marker>
        ))}

      {/* Live snapped puck — a big arrow pointing in the travel direction. In
          follow mode the map is rotated to travel direction (arrow points up);
          in north-up mode the arrow itself rotates by the route bearing. */}
      {isActive && progress ? (
        <Marker id="nav-puck" lngLat={[(smoothedPuck ?? progress.snapped).lng, (smoothedPuck ?? progress.snapped).lat]}>
          <NavPuck
            rotation={navCameraMode === "north" ? progress.bearing : 0}
            responding={respondingToOpenIncident}
          />
        </Marker>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  endpoint: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  startPoint: { backgroundColor: "#22c55e" },
  startGlyph: { color: "#04121f", fontSize: 12, fontWeight: "900", marginLeft: 2 },
  destPoint: { backgroundColor: "#1e293b" },
  destGlyph: { color: "#fbbf24", fontSize: 16, fontWeight: "900" },
  viaMarker: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#3B82F6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 5,
  },
  viaText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  puckArrowWrap: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  puckArrowHalo: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(59,130,246,0.22)",
  },
  // White outline triangle (slightly larger, behind the blue one).
  puckArrowOutline: {
    position: "absolute",
    width: 0,
    height: 0,
    borderLeftWidth: 15,
    borderRightWidth: 15,
    borderBottomWidth: 28,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#FFFFFF",
  },
  // Blue travel-direction arrowhead on top.
  puckArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderBottomWidth: 21,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#2563eb",
    marginBottom: 3,
  },
});
