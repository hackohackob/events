import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GeoJSONSource, Layer, Marker } from "@maplibre/maplibre-react-native";
import { useMapStore } from "../map/map-store";
import { useSessionStore } from "../security/session-store";
import { useNavStore } from "./nav-store";
import { arcPoints, distanceMeters } from "./geo";
import type { LngLat } from "./types";

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

function lineFeature(coordinates: LngLat[]) {
  return {
    type: "FeatureCollection" as const,
    features: [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } }],
  };
}

function isClosed(status?: string): boolean {
  return status === "resolved" || status === "closed" || status === "archived";
}

/**
 * Curved, flowing "Assigned" lines from a responding medic to their incident —
 * shown once a medic is assigned/responding but *before* they start navigating
 * (no nav route yet). When they begin navigation the coloured route replaces
 * this, so the curved line disappears. Rendered as MapLibre children.
 */
export function AssignedRoutesLayer() {
  const markers = useMapStore((s) => s.markers);
  const myId = useSessionStore((s) => s.userId);
  const navPhase = useNavStore((s) => s.phase);
  const [dashIndex, setDashIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setDashIndex((i) => (i + 1) % DASH_SEQUENCE.length), 130);
    return () => clearInterval(timer);
  }, []);

  const medicById = new Map(markers.filter((m) => m.type === "paramedic").map((m) => [m.id, m]));
  const links: Array<{ key: string; arc: LngLat[]; mid: LngLat; distanceM: number; dimmed: boolean }> = [];

  // While I'm responding to an incident, other medics' arcs fade into the
  // background so my own link stays the visual focus.
  const amAssigned = markers.some(
    (m) =>
      m.type === "incident" &&
      !isClosed(m.status) &&
      (m.respondingParamedicIds ?? []).includes(myId ?? "__none__"),
  );

  // Once I've picked a transport profile, route proposal lines are on screen
  // and my own curved "Assigned" line would just be clutter on top. While the
  // transport picker is still open (phase "transport") nothing is drawn yet,
  // so the arc stays.
  const myRouteLinesVisible = navPhase === "variants" || navPhase === "editing" || navPhase === "active";

  for (const incident of markers) {
    if (incident.type !== "incident" || isClosed(incident.status)) continue;
    if (!Number.isFinite(incident.lng) || !Number.isFinite(incident.lat)) continue;
    for (const medicId of incident.respondingParamedicIds ?? []) {
      if (medicId === myId && myRouteLinesVisible) continue;
      const medic = medicById.get(medicId);
      // Skip once the medic is actually navigating — the route takes over.
      if (!medic || medic.route || !Number.isFinite(medic.lng) || !Number.isFinite(medic.lat)) continue;
      const arc = arcPoints({ lat: medic.lat, lng: medic.lng }, { lat: incident.lat, lng: incident.lng });
      links.push({
        key: `${incident.id}-${medicId}`,
        arc,
        mid: arc[Math.floor(arc.length / 2)],
        distanceM: distanceMeters({ lat: medic.lat, lng: medic.lng }, { lat: incident.lat, lng: incident.lng }),
        dimmed: amAssigned && medicId !== myId,
      });
    }
  }
  if (links.length === 0) return null;

  return (
    <>
      {links.map((link) => (
        <React.Fragment key={`assigned-${link.key}`}>
          {!link.dimmed ? (
            <GeoJSONSource id={`assigned-glow-${link.key}`} data={lineFeature(link.arc)}>
              <Layer
                id={`assigned-glow-layer-${link.key}`}
                type="line"
                layout={{ "line-join": "round", "line-cap": "round" }}
                paint={{ "line-color": "rgba(239,68,68,0.45)", "line-width": 8, "line-blur": 5 }}
              />
            </GeoJSONSource>
          ) : null}
          <GeoJSONSource id={`assigned-base-${link.key}`} data={lineFeature(link.arc)}>
            <Layer
              id={`assigned-base-layer-${link.key}`}
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{ "line-color": link.dimmed ? "rgba(220,38,38,0.45)" : "rgba(220,38,38,0.85)", "line-width": 4 }}
            />
          </GeoJSONSource>
          {!link.dimmed ? (
            <GeoJSONSource id={`assigned-flow-${link.key}`} data={lineFeature(link.arc)}>
              <Layer
                id={`assigned-flow-layer-${link.key}`}
                type="line"
                layout={{ "line-join": "round", "line-cap": "round" }}
                paint={{ "line-color": "#fecaca", "line-width": 2.6, "line-dasharray": DASH_SEQUENCE[dashIndex] }}
              />
            </GeoJSONSource>
          ) : null}
          {/* No label on very short links (the arc itself reads clearly), a
              compact one on short links, full size otherwise. */}
          {link.distanceM >= TAG_MIN_DISTANCE_M && !link.dimmed ? (
            <Marker id={`assigned-tag-${link.key}`} lngLat={[link.mid[0], link.mid[1]]}>
              <View style={[styles.tag, link.distanceM < TAG_SMALL_DISTANCE_M && styles.tagSmall]}>
                <Text style={[styles.tagText, link.distanceM < TAG_SMALL_DISTANCE_M && styles.tagTextSmall]}>
                  Assigned
                </Text>
              </View>
            </Marker>
          ) : null}
        </React.Fragment>
      ))}
    </>
  );
}

/** Below this medic↔incident distance the label is dropped entirely. */
const TAG_MIN_DISTANCE_M = 150;
/** Below this distance the label renders in its compact form. */
const TAG_SMALL_DISTANCE_M = 400;

const styles = StyleSheet.create({
  tag: {
    backgroundColor: "#dc2626",
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
    paddingVertical: 4,
    paddingHorizontal: 11,
    shadowColor: "#ef4444",
    shadowOpacity: 0.7,
    shadowRadius: 8,
    elevation: 8,
  },
  tagSmall: { paddingVertical: 2, paddingHorizontal: 7, borderWidth: 1 },
  tagText: { color: "#fff", fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },
  tagTextSmall: { fontSize: 8.5, letterSpacing: 0.3 },
});
