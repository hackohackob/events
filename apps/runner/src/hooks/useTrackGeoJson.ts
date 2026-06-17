import { useEffect, useState } from "react";
import type { EventTrackLike, TrackGeoJson } from "../api/contracts-shim";
import { fetchTrackGeoJson, fetchTracks } from "../api";
import type { TrackKey } from "../lib/types";

export interface ResolvedTrack {
  geojson: TrackGeoJson;
  coords: [number, number][];
  meta: TrackGeoJson["features"][number]["properties"];
}

/**
 * Resolve the runner's selected design track (10K/21K/…) to a real backend
 * track + its GeoJSON. Matches by closest distance to the track label, falling
 * back to the first available track.
 */
export function useTrackGeoJson(eventId: string, trackKey: TrackKey | null) {
  const [track, setTrack] = useState<ResolvedTrack | null>(null);
  const [tracks, setTracks] = useState<EventTrackLike[]>([]);

  useEffect(() => {
    let alive = true;
    fetchTracks()
      .then((t) => alive && setTracks(t))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [eventId]);

  useEffect(() => {
    if (tracks.length === 0) return;
    const targetKm = trackKey ? parseInt(trackKey, 10) : null;
    // Pick the track whose label mentions the chosen distance, else the first.
    const chosen =
      (targetKm != null &&
        tracks.find((t) => new RegExp(`\\b${targetKm}\\s*k`, "i").test(t.label))) ||
      tracks[0];

    let alive = true;
    fetchTrackGeoJson(eventId, chosen.id)
      .then((geojson) => {
        if (!alive) return;
        const feature = geojson.features[0];
        setTrack({
          geojson,
          coords: feature.geometry.coordinates,
          meta: feature.properties,
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [eventId, trackKey, tracks]);

  return track;
}
