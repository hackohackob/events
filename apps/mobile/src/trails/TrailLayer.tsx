import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GeoJSONSource, Layer, Marker } from "@maplibre/maplibre-react-native";
import { trailColor } from "@events/contracts";
import { useTrailStore } from "./trail-store";
import { formatDurationCompact, positionAt, trailRampColor, trailRuns, type LngLat, type TrailRun } from "./trail-geometry";

/** Below this zoom the dwell pills stack into an unreadable pile. */
const DWELL_MIN_ZOOM = 11.5;

function lineFeature(coordinates: LngLat[]) {
  return {
    type: "FeatureCollection" as const,
    features: [
      { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } },
    ],
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * The location-history overlay: one medic's last N hours drawn as a comet —
 * near-invisible where the trail is oldest, full colour at the newest end — so
 * "where have they been recently" reads without a legend.
 *
 * The fade is maplibre's own `lineGradient` over `line-progress`, which needs
 * `lineMetrics` on the source. That keeps it to two native line layers no
 * matter how long the trail is; colouring per-segment instead would have put
 * hundreds of layers on the map and visibly stuttered the pan.
 *
 * Renders nothing at all when no trail is open, so the map pays nothing for a
 * feature nobody has asked for.
 */
export function TrailLayer({ zoom }: { zoom: number }) {
  const trail = useTrailStore((s) => s.trail);
  const cursorMs = useTrailStore((s) => s.cursorMs);

  // Split at tracking outages so a Doze freeze isn't drawn as a straight line
  // across the map — that reads as travel the medic never made.
  const runs = useMemo<TrailRun[]>(
    () => (trail ? trailRuns(trail, cursorMs ?? undefined) : []),
    [trail, cursorMs],
  );

  const puck = useMemo(
    () => (trail && cursorMs != null ? positionAt(trail, cursorMs) : null),
    [trail, cursorMs],
  );

  if (!trail) return null;
  const color = trailColor(trail.medicId);
  const showDwells = zoom >= DWELL_MIN_ZOOM;

  return (
    <>
      {runs.map((run, index) => (
        <React.Fragment key={`trail-run-${index}`}>
          {/* Dark casing — without it the trail disappears over satellite tiles. */}
          <GeoJSONSource id={`trail-casing-${index}`} data={lineFeature(run.coordinates)}>
            <Layer
              id={`trail-casing-layer-${index}`}
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{ "line-color": "rgba(8,15,28,0.8)", "line-width": 7 }}
            />
          </GeoJSONSource>
          {/* Each run carries its own slice of the age ramp, so the comet keeps
              fading continuously across the breaks. */}
          <GeoJSONSource id={`trail-line-${index}`} data={lineFeature(run.coordinates)} lineMetrics>
            <Layer
              id={`trail-line-layer-${index}`}
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{
                "line-width": 4,
                "line-gradient": [
                  "interpolate", ["linear"], ["line-progress"],
                  0, trailRampColor(color, run.startFrac),
                  1, trailRampColor(color, run.endFrac),
                ],
              }}
            />
          </GeoJSONSource>
        </React.Fragment>
      ))}

      {showDwells
        ? trail.dwells.map((dwell, index) => {
            // Mid-scrub, a pause hasn't happened yet until the cursor reaches it.
            if (cursorMs != null && new Date(dwell.from).getTime() > cursorMs) return null;
            return (
              <Marker key={`trail-dwell-${index}`} id={`trail-dwell-${index}`} lngLat={[dwell.lng, dwell.lat]}>
                <View style={[styles.dwell, { backgroundColor: color, shadowColor: color }]}>
                  {/* numberOfLines guards the same wrap the web badge hit: the
                      pill grows sideways, the label never stacks. */}
                  <Text style={styles.dwellText} numberOfLines={1} allowFontScaling={false}>
                    {formatDurationCompact(dwell.durationMs)}
                  </Text>
                </View>
              </Marker>
            );
          })
        : null}

      {puck ? (
        <Marker id="trail-puck" lngLat={puck}>
          <View style={styles.puckWrap}>
            <View style={[styles.puckHalo, { backgroundColor: hexToRgba(color, 0.28) }]} />
            <View style={[styles.puck, { backgroundColor: color }]} />
          </View>
        </Marker>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  dwell: {
    minWidth: 30,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "rgba(8,15,28,0.85)",
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  dwellText: { color: "#0a1220", fontSize: 10, fontWeight: "900" },
  puckWrap: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  puckHalo: { position: "absolute", width: 32, height: 32, borderRadius: 16 },
  puck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.9)",
  },
});
