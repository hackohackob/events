import React from "react";
import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import { useZoneDrawStore } from "./zone-draw-store";

/** Live freehand trail + smoothed pending-polygon preview, rendered on the map. */
export function ZoneSketchLayer() {
  const sketch = useZoneDrawStore((s) => s.sketch);
  const pending = useZoneDrawStore((s) => s.pending);

  if (pending && pending.length >= 3) {
    return (
      <GeoJSONSource
        id="zone-pending-source"
        data={{
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [[...pending, pending[0]]] },
        }}
      >
        <Layer id="zone-pending-fill" type="fill" paint={{ "fill-color": "#f59e0b", "fill-opacity": 0.18 }} />
        <Layer
          id="zone-pending-line"
          type="line"
          paint={{ "line-color": "#f59e0b", "line-width": 2.5, "line-dasharray": [2, 1.5] }}
        />
      </GeoJSONSource>
    );
  }

  if (sketch.length >= 2) {
    return (
      <GeoJSONSource
        id="zone-sketch-source"
        data={{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: sketch } }}
      >
        <Layer
          id="zone-sketch-line"
          type="line"
          paint={{ "line-color": "#f59e0b", "line-width": 2.5, "line-opacity": 0.9, "line-dasharray": [2, 1.5] }}
        />
      </GeoJSONSource>
    );
  }

  return null;
}
