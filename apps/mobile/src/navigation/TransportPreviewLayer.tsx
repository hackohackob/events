import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GeoJSONSource, Layer, Marker } from "@maplibre/maplibre-react-native";
import { Feather } from "@expo/vector-icons";
import { useNavStore } from "./nav-store";
import { useLocationStatus } from "../debug/location-status";
import { arcPoints } from "./geo";
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

/** Isolated ant-march overlay so the 130ms dash tick re-renders only this line. */
function FlowLine({ arc }: { arc: LngLat[] }) {
  const [dashIndex, setDashIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setDashIndex((i) => (i + 1) % DASH_SEQUENCE.length), 130);
    return () => clearInterval(timer);
  }, []);
  return (
    <GeoJSONSource id="transport-preview-flow" data={lineFeature(arc)}>
      <Layer
        id="transport-preview-flow-layer"
        type="line"
        layout={{ "line-join": "round", "line-cap": "round" }}
        paint={{ "line-color": "#bfdbfe", "line-width": 2.6, "line-dasharray": DASH_SEQUENCE[dashIndex] }}
      />
    </GeoJSONSource>
  );
}

/**
 * While the transport picker is open (nav phase "transport", before any route
 * exists): a blue flowing arc from me to the chosen destination + a flag pin on
 * the destination — the same visual language as the red "Assigned" arcs, in
 * navigation blue. Disappears the moment route proposals take over.
 */
export function TransportPreviewLayer() {
  const phase = useNavStore((s) => s.phase);
  const destination = useNavStore((s) => s.destination);
  const fix = useLocationStatus((s) => s.lastFix);

  if (phase !== "transport" || !destination || !fix) return null;
  if (!Number.isFinite(destination.lng) || !Number.isFinite(destination.lat)) return null;

  const arc = arcPoints({ lat: fix.lat, lng: fix.lng }, { lat: destination.lat, lng: destination.lng });

  return (
    <>
      <GeoJSONSource id="transport-preview-glow" data={lineFeature(arc)}>
        <Layer
          id="transport-preview-glow-layer"
          type="line"
          layout={{ "line-join": "round", "line-cap": "round" }}
          paint={{ "line-color": "rgba(59,130,246,0.45)", "line-width": 8, "line-blur": 5 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="transport-preview-base" data={lineFeature(arc)}>
        <Layer
          id="transport-preview-base-layer"
          type="line"
          layout={{ "line-join": "round", "line-cap": "round" }}
          paint={{ "line-color": "rgba(37,99,235,0.85)", "line-width": 4 }}
        />
      </GeoJSONSource>
      <FlowLine arc={arc} />

      {/* Destination flag pin. */}
      <Marker id="transport-preview-dest" lngLat={[destination.lng, destination.lat]}>
        <View style={styles.destWrap} pointerEvents="none">
          <View style={styles.destPin}>
            <Feather name="flag" size={15} color="#ffffff" />
          </View>
          <Text style={styles.destLabel} numberOfLines={1}>
            {destination.label}
          </Text>
        </View>
      </Marker>
    </>
  );
}

const styles = StyleSheet.create({
  destWrap: { alignItems: "center", gap: 3 },
  destPin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#2563eb",
    borderWidth: 2,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2563eb",
    shadowOpacity: 0.7,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 3 },
    elevation: 10,
  },
  destLabel: {
    maxWidth: 150,
    color: "#dbeafe",
    fontSize: 11,
    fontWeight: "800",
    backgroundColor: "rgba(7, 12, 22, 0.85)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.4)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: "hidden",
  },
});
