import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GeoJSONSource, Layer, Marker } from "@maplibre/maplibre-react-native";
import type { EventZone } from "@events/contracts";
import { ringCentroid } from "./zone-geometry";

/**
 * Renders the visible team zones: tinted fill + outline (dashed when the zone
 * carries an entry alarm) and a floating name label at the centroid. Zones are
 * medic-only — runner sessions never receive any to render.
 *
 * The source + layers stay mounted permanently (with an empty collection when
 * no zone is visible): mounting/unmounting GL sources as zones toggle crashes
 * the native MapLibre surface (gray screen).
 */
export function ZonesLayer({ zones }: { zones: EventZone[] }) {
  const drawable = useMemo(() => zones.filter((z) => z.visible && z.polygon.length >= 3), [zones]);

  const collection = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: drawable.map((zone) => ({
        type: "Feature" as const,
        properties: { color: zone.color, alarm: zone.alarm },
        geometry: {
          type: "Polygon" as const,
          coordinates: [[...zone.polygon, zone.polygon[0]]],
        },
      })),
    }),
    [drawable],
  );

  return (
    <>
      <GeoJSONSource id="team-zones-source" data={collection}>
        <Layer
          id="team-zones-fill"
          type="fill"
          paint={{ "fill-color": ["get", "color"], "fill-opacity": 0.16 }}
        />
        <Layer
          id="team-zones-outline"
          type="line"
          filter={["==", ["get", "alarm"], false]}
          paint={{ "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.85 }}
        />
        {/* Alarm zones get a dashed outline so they read as "hot" at a glance. */}
        <Layer
          id="team-zones-outline-alarm"
          type="line"
          filter={["==", ["get", "alarm"], true]}
          paint={{
            "line-color": ["get", "color"],
            "line-width": 2.5,
            "line-opacity": 0.95,
            "line-dasharray": [2, 1.5],
          }}
        />
      </GeoJSONSource>

      {drawable.map((zone) => {
        const [lng, lat] = ringCentroid(zone.polygon);
        return (
          <Marker key={`zone-label-${zone.id}`} lngLat={[lng, lat]} pointerEvents="none">
            <View style={[styles.label, { borderColor: `${zone.color}88` }]} pointerEvents="none">
              <Text style={[styles.labelText, { color: zone.color }]} numberOfLines={1}>
                {zone.alarm ? "🔔 " : ""}{zone.name}
              </Text>
            </View>
          </Marker>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    backgroundColor: "rgba(6, 12, 24, 0.8)",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 180,
  },
  labelText: { fontSize: 11, fontWeight: "800" },
});
