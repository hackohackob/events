import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackGeoJson } from "../api/contracts-shim";
import { fetchTrackGeoJson } from "../api";
import { useRefetchOnFocus } from "./useRefetchOnFocus";

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
  // Bumped on every (re)load so a response from a superseded request (e.g. the
  // track/event changed while it was in flight) can't clobber newer state.
  const requestId = useRef(0);

  const load = useCallback(() => {
    if (!trackId) return;
    const id = ++requestId.current;
    fetchTrackGeoJson(eventId, trackId)
      .then((geojson) => {
        if (requestId.current !== id) return;
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
  }, [eventId, trackId]);

  useEffect(() => {
    if (!trackId) {
      requestId.current += 1; // invalidate any in-flight fetch for the old track
      setTrack(null);
      return;
    }
    load();
  }, [trackId, load]);

  // Likely means the phone was locked/backgrounded — re-fetch in case the
  // track changed (or the previous fetch raced a still-in-flight event switch).
  useRefetchOnFocus(load);

  return track;
}
