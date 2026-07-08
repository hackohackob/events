import React, { useMemo } from "react";
import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import { useZoneDrawStore } from "./zone-draw-store";

/**
 * Live freehand trail + smoothed pending-polygon preview, rendered on the map.
 *
 * ONE source and a fixed set of layers stay mounted for the whole session and
 * only the GeoJSON data changes — swapping sources/layers mid-gesture crashes
 * the native MapLibre surface (gray screen). The fill layer simply has nothing
 * to draw while the data is still a LineString.
 */
export function ZoneSketchLayer() {
  const sketch = useZoneDrawStore((s) => s.sketch);
  const pending = useZoneDrawStore((s) => s.pending);

  const data = useMemo(() => {
    const features: GeoJSON.Feature[] = [];
    if (pending && pending.length >= 3) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [[...pending, pending[0]]] },
      });
    } else if (sketch.length >= 2) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: sketch },
      });
    }
    return { type: "FeatureCollection" as const, features };
  }, [sketch, pending]);

  return (
    <GeoJSONSource id="zone-draw-source" data={data}>
      <Layer id="zone-draw-fill" type="fill" paint={{ "fill-color": "#f59e0b", "fill-opacity": 0.18 }} />
      <Layer
        id="zone-draw-line"
        type="line"
        paint={{ "line-color": "#f59e0b", "line-width": 2.5, "line-opacity": 0.9, "line-dasharray": [2, 1.5] }}
      />
    </GeoJSONSource>
  );
}
