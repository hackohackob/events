import maplibregl, { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { getMapyTilesTemplateUrl } from "./env";
import type { EventTrack } from "./api/events";

interface EventMapProps {
  mode: "preview" | "operations";
  tracks?: EventTrack[];
}

const center: [number, number] = [23.4267, 42.5968];
const palette = ["#8A2BE2", "#1E90FF", "#28A745", "#FF8C00", "#ef4444"];

const fallbackTracks: EventTrack[] = [
  {
    id: "fallback-10k",
    label: "Trail Run 10 km",
    color: "#1E90FF",
    points: [
      { lng: 23.4144, lat: 42.6024 },
      { lng: 23.4209, lat: 42.6071 },
      { lng: 23.4329, lat: 42.606 },
      { lng: 23.4429, lat: 42.5992 },
      { lng: 23.4394, lat: 42.5907 },
      { lng: 23.4255, lat: 42.5882 },
      { lng: 23.4136, lat: 42.5945 },
      { lng: 23.4144, lat: 42.6024 },
    ],
  },
  {
    id: "fallback-21k",
    label: "Trail Run 21 km",
    color: "#8A2BE2",
    points: [
      { lng: 23.401, lat: 42.608 },
      { lng: 23.418, lat: 42.616 },
      { lng: 23.444, lat: 42.612 },
      { lng: 23.462, lat: 42.595 },
      { lng: 23.451, lat: 42.578 },
      { lng: 23.422, lat: 42.574 },
      { lng: 23.397, lat: 42.59 },
      { lng: 23.401, lat: 42.608 },
    ],
  },
  {
    id: "fallback-42k",
    label: "Marathon 42 km",
    color: "#FF8C00",
    points: [
      { lng: 23.391, lat: 42.613 },
      { lng: 23.409, lat: 42.631 },
      { lng: 23.449, lat: 42.628 },
      { lng: 23.478, lat: 42.605 },
      { lng: 23.469, lat: 42.566 },
      { lng: 23.431, lat: 42.556 },
      { lng: 23.383, lat: 42.582 },
      { lng: 23.391, lat: 42.613 },
    ],
  },
];

const operationalPoints = [
  { type: "paramedic", label: "Team Alpha", coordinates: [23.427, 42.604] },
  { type: "paramedic", label: "Team Bravo", coordinates: [23.445, 42.592] },
  { type: "incident", label: "INC-1042", coordinates: [23.435, 42.598] },
  { type: "incident", label: "INC-1038", coordinates: [23.411, 42.595] },
  { type: "runner", label: "Cluster", coordinates: [23.421, 42.588] },
  { type: "runner", label: "Cluster", coordinates: [23.455, 42.604] },
];

function createMapStyle() {
  const mapyTilesTemplateUrl = getMapyTilesTemplateUrl();
  const baseTilesTemplateUrl = mapyTilesTemplateUrl ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileSize = mapyTilesTemplateUrl ? 512 : 256;

  return {
    version: 8 as const,
    sources: {
      base: {
        type: "raster" as const,
        tiles: [baseTilesTemplateUrl],
        tileSize,
        attribution: mapyTilesTemplateUrl
          ? '<a href="https://mapy.cz/" target="_blank" rel="noreferrer">Mapy.cz</a>'
          : '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      },
    },
    layers: [{ id: "base", type: "raster" as const, source: "base" }],
  };
}

function toTrackCollection(tracks: EventTrack[]) {
  return {
    type: "FeatureCollection" as const,
    features: tracks
      .filter((track) => track.points.length > 1)
      .map((track, index) => ({
        type: "Feature" as const,
        properties: {
          id: track.id,
          name: track.label,
          color: track.color || palette[index % palette.length],
        },
        geometry: {
          type: "LineString" as const,
          coordinates: track.points.map((point) => [point.lng, point.lat]),
        },
      })),
  };
}

function trackBounds(tracks: EventTrack[]): [[number, number], [number, number]] | null {
  const points = tracks.flatMap((track) => track.points);
  if (!points.length) return null;
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

function addEventLayers(map: MapLibreMap, mode: EventMapProps["mode"], tracks: EventTrack[]) {
  const trackCollection = toTrackCollection(tracks);

  if (!map.getSource("event-tracks")) {
    map.addSource("event-tracks", {
      type: "geojson",
      data: trackCollection,
    });
  } else {
    (map.getSource("event-tracks") as GeoJSONSource).setData(trackCollection);
  }

  if (!map.getLayer("event-tracks-glow")) {
    map.addLayer({
      id: "event-tracks-glow",
      type: "line",
      source: "event-tracks",
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": 0.22,
        "line-width": mode === "operations" ? 18 : 14,
        "line-blur": 8,
      },
    });
  }

  if (!map.getLayer("event-tracks")) {
    map.addLayer({
      id: "event-tracks",
      type: "line",
      source: "event-tracks",
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": 0.98,
        "line-width": mode === "operations" ? 5 : 4.5,
      },
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
    });
  }

  if (mode !== "operations") return;

  const pointCollection = {
    type: "FeatureCollection" as const,
    features: operationalPoints.map((point) => ({
      type: "Feature" as const,
      properties: { type: point.type, label: point.label },
      geometry: { type: "Point" as const, coordinates: point.coordinates },
    })),
  };

  if (!map.getSource("operations-points")) {
    map.addSource("operations-points", { type: "geojson", data: pointCollection });
  } else {
    (map.getSource("operations-points") as GeoJSONSource).setData(pointCollection);
  }

  if (!map.getLayer("operations-points")) {
    map.addLayer({
      id: "operations-points",
      type: "circle",
      source: "operations-points",
      paint: {
        "circle-color": ["match", ["get", "type"], "paramedic", "#2563eb", "incident", "#dc2626", "runner", "#006b5c", "#17201d"],
        "circle-radius": ["match", ["get", "type"], "incident", 9, "paramedic", 8, 5],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
      },
    });
  }
}

export function EventMap({ mode, tracks }: EventMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapError, setMapError] = useState(false);
  const visibleTracks = useMemo(() => (tracks?.length ? tracks : fallbackTracks), [tracks]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: createMapStyle(),
        center,
        zoom: mode === "operations" ? 12.2 : 11.4,
        attributionControl: false,
      });
    } catch (error) {
      setMapError(true);
      return;
    }

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

    map.on("load", () => {
      addEventLayers(map, mode, visibleTracks);
      const bounds = trackBounds(visibleTracks);
      if (bounds) {
        map.fitBounds(bounds, { padding: mode === "operations" ? 72 : 56, duration: 0 });
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const refresh = () => {
      addEventLayers(map, mode, visibleTracks);
      const bounds = trackBounds(visibleTracks);
      if (bounds) map.fitBounds(bounds, { padding: mode === "operations" ? 72 : 56, duration: 450 });
    };
    if (map.isStyleLoaded()) refresh();
    else map.once("load", refresh);
  }, [mode, visibleTracks]);

  return (
    <div className="event-map" ref={containerRef}>
      {mapError && (
        <div className="map-fallback">
          <strong>Map preview unavailable</strong>
          <span>MapLibre needs WebGL. The map will render in a browser with WebGL enabled.</span>
        </div>
      )}
    </div>
  );
}
