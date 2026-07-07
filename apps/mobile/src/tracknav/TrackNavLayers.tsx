import React, { useMemo } from "react";
import { GeoJSONSource, Layer, Marker } from "@maplibre/maplibre-react-native";
import { NavPuck } from "../navigation/NavPuck";
import { useSmoothedPosition } from "../navigation/useSmoothedPosition";
import type { LngLat } from "../navigation/types";
import { useTrackNavStore } from "./track-nav-store";
import { splitAtAlong } from "./turn-detection";

const DEFAULT_TRACK_COLOR = "#34d399";

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

function pointFeatures(points: LngLat[]) {
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
 * MapLibre children for track-following mode. Must render *inside* the map
 * element. The travelled portion dims to 40%, the part ahead gets the premium
 * glow + white outline treatment in the track's own colour, maneuver dots mark
 * upcoming turns, and while off-track a dashed line points the way back.
 */
export function TrackNavLayers() {
  const phase = useTrackNavStore((s) => s.phase);
  const prepared = useTrackNavStore((s) => s.prepared);
  const progress = useTrackNavStore((s) => s.progress);
  const track = useTrackNavStore((s) => s.track);
  const camMode = useTrackNavStore((s) => s.camMode);

  const color = track?.color ?? DEFAULT_TRACK_COLOR;

  // Puck glides between fixes; real position when off-track, snapped otherwise.
  const puckTarget = phase !== "idle" && progress ? (progress.offTrack ? progress.raw : progress.snapped) : null;
  const smoothedPuck = useSmoothedPosition(puckTarget);

  const split = useMemo(() => {
    if (!prepared) return null;
    if (!progress || progress.offTrack) {
      return { behind: [] as LngLat[], ahead: prepared.geometry };
    }
    return splitAtAlong(prepared, progress.alongMeters, progress.snapped);
  }, [prepared, progress]);

  // Upcoming maneuver dots only — passed turns disappear with the dimmed tail.
  const maneuverDots = useMemo(() => {
    if (!prepared) return pointFeatures([]);
    const along = progress?.alongMeters ?? 0;
    return pointFeatures(
      prepared.instructions
        .filter((inst) => inst.maneuver !== "arrive" && inst.alongMeters > along + 5)
        .map((inst) => inst.location),
    );
  }, [prepared, progress]);

  const offTrackLine = useMemo(() => {
    if (!progress?.offTrack || !progress.nearestPoint) return null;
    return lineFeature([
      [progress.raw.lng, progress.raw.lat],
      [progress.nearestPoint.lng, progress.nearestPoint.lat],
    ]);
  }, [progress]);

  if (phase === "idle" || !prepared || !split) return null;

  return (
    <>
      {/* Travelled portion — dimmed tail so covered ground stays readable. */}
      {split.behind.length >= 2 ? (
        <GeoJSONSource id="tracknav-behind-src" data={lineFeature(split.behind)}>
          <Layer
            id="tracknav-behind"
            type="line"
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={{ "line-color": color, "line-width": 5, "line-opacity": 0.35 }}
          />
        </GeoJSONSource>
      ) : null}

      {/* Ahead — glow, white outline, then the track colour on top. */}
      <GeoJSONSource id="tracknav-glow-src" data={lineFeature(split.ahead)}>
        <Layer
          id="tracknav-glow"
          type="line"
          layout={{ "line-join": "round", "line-cap": "round" }}
          paint={{ "line-color": color, "line-width": 20, "line-blur": 14, "line-opacity": 0.55 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="tracknav-outline-src" data={lineFeature(split.ahead)}>
        <Layer
          id="tracknav-outline"
          type="line"
          layout={{ "line-join": "round", "line-cap": "round" }}
          paint={{ "line-color": "#FFFFFF", "line-width": 12, "line-opacity": 0.95 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="tracknav-line-src" data={lineFeature(split.ahead)}>
        <Layer
          id="tracknav-line"
          type="line"
          layout={{ "line-join": "round", "line-cap": "round" }}
          paint={{ "line-color": color, "line-width": 8 }}
        />
      </GeoJSONSource>

      {/* Upcoming turn dots. */}
      <GeoJSONSource id="tracknav-turns-src" data={maneuverDots}>
        <Layer
          id="tracknav-turns-halo"
          type="circle"
          paint={{ "circle-radius": 7, "circle-color": "#FFFFFF", "circle-opacity": 0.9 }}
        />
        <Layer
          id="tracknav-turns-dot"
          type="circle"
          paint={{ "circle-radius": 4, "circle-color": "#f5b301" }}
        />
      </GeoJSONSource>

      {/* Way back to the track while off it. */}
      {offTrackLine ? (
        <GeoJSONSource id="tracknav-offtrack-src" data={offTrackLine}>
          <Layer
            id="tracknav-offtrack"
            type="line"
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={{
              "line-color": "#f5b301",
              "line-width": 4,
              "line-dasharray": [1.2, 1.6],
              "line-opacity": 0.9,
            }}
          />
        </GeoJSONSource>
      ) : null}

      {/* Finish flag. */}
      <GeoJSONSource
        id="tracknav-finish-src"
        data={pointFeatures(prepared.geometry.length > 0 ? [prepared.geometry[prepared.geometry.length - 1]] : [])}
      >
        <Layer
          id="tracknav-finish-halo"
          type="circle"
          paint={{ "circle-radius": 10, "circle-color": "#FFFFFF", "circle-opacity": 0.95 }}
        />
        <Layer
          id="tracknav-finish-dot"
          type="circle"
          paint={{ "circle-radius": 6, "circle-color": color }}
        />
      </GeoJSONSource>

      {/* Live puck. In follow mode the map rotates (arrow points up); in
          north-up the arrow itself rotates by the travel bearing. */}
      {progress ? (
        <Marker
          id="tracknav-puck"
          lngLat={[(smoothedPuck ?? progress.snapped).lng, (smoothedPuck ?? progress.snapped).lat]}
        >
          <NavPuck rotation={camMode === "north" ? progress.bearing : 0} />
        </Marker>
      ) : null}
    </>
  );
}
