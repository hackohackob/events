import { useEffect, useState } from "react";
import type { TrackGeoJson } from "../api/contracts-shim";
import { fetchTrackGeoJson } from "../api";

export interface ResolvedTrack {
  geojson: TrackGeoJson;
  coords: [number, number][];
  /** Per-point elevation (metres); undefined entry where unknown. */
  elevations: (number | undefined)[];
  meta: TrackGeoJson["features"][number]["properties"];
}

/** Fetch the GeoJSON for the runner's selected track id. */
export function useTrackGeoJson(eventId: string, trackId: string | null) {
  const [track, setTrack] = useState<ResolvedTrack | null>(null);

  useEffect(() => {
    if (!trackId) {
      setTrack(null);
      return;
    }
    let alive = true;
    fetchTrackGeoJson(eventId, trackId)
      .then((geojson) => {
        if (!alive) return;
        const feature = geojson.features[0];
        const raw = feature.geometry.coordinates;
        setTrack({
          geojson,
          coords: raw.map((c) => [c[0], c[1]] as [number, number]),
          elevations: raw.map((c) => (c.length > 2 ? c[2] : undefined)),
          meta: feature.properties,
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [eventId, trackId]);

  return track;
}
