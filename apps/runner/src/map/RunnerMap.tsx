import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import type { PublicMedicState } from "../api/contracts-shim";
import type { Fix } from "../hooks/useGeolocation";
import type { PoiLike } from "../api";

const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

interface Props {
  coords: [number, number][] | null;
  routeColor: string;
  medics: PublicMedicState[];
  pois: PoiLike[];
  fix: Fix | null;
  youLabel?: string;
  recenterSignal?: number;
  interactive?: boolean;
}

function poiVisual(type: string): { bg: string; glyph: string } {
  const t = type.toLowerCase();
  if (/tent|camp|hospital|medical/.test(t)) return { bg: "#FFFFFF", glyph: "✚" };
  if (/water|hydrat|aid/.test(t)) return { bg: "#2E9BFF", glyph: "💧" };
  if (/check|cp|control/.test(t)) return { bg: "#0C1119", glyph: "•" };
  if (/start|finish/.test(t)) return { bg: "#14B576", glyph: "🏁" };
  return { bg: "#16273A", glyph: "📍" };
}

export function RunnerMap({
  coords,
  routeColor,
  medics,
  pois,
  fix,
  youLabel,
  recenterSignal,
  interactive = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const youMarkerRef = useRef<maplibregl.Marker | null>(null);
  const readyRef = useRef(false);

  // Init
  useEffect(() => {
    if (!containerRef.current) return;
    const center: [number, number] = fix
      ? [fix.lng, fix.lat]
      : coords && coords.length
        ? coords[Math.floor(coords.length / 2)]
        : [23.32, 42.7];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center,
      zoom: 13.5,
      attributionControl: false,
      interactive,
    });
    map.getCanvas().style.filter = "var(--map-filter)";
    mapRef.current = map;
    map.on("load", () => {
      readyRef.current = true;
      drawRoute();
    });
    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function drawRoute() {
    const map = mapRef.current;
    if (!map || !readyRef.current || !coords || coords.length < 2) return;
    const data = {
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: coords },
      properties: {},
    };
    const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
      return;
    }
    map.addSource("route", { type: "geojson", data });
    map.addLayer({
      id: "route-casing",
      type: "line",
      source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": 9 },
    });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": routeColor, "line-width": 4.5 },
    });
    const bounds = coords.reduce(
      (b, c) => b.extend(c as [number, number]),
      new maplibregl.LngLatBounds(coords[0], coords[0]),
    );
    map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 0 });
  }

  // Redraw route when coords change
  useEffect(() => {
    drawRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, routeColor]);

  // Medic + POI markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const poi of pois) {
      const v = poiVisual(poi.type);
      const el = document.createElement("div");
      el.style.cssText = `width:28px;height:28px;border-radius:50%;background:${v.bg};display:grid;place-items:center;font-size:14px;border:2px solid ${v.bg === "#FFFFFF" ? "var(--critical)" : "rgba(255,255,255,0.6)"};box-shadow:0 2px 6px rgba(0,0,0,0.4);color:${v.bg === "#FFFFFF" ? "var(--critical)" : "#fff"}`;
      el.textContent = poi.icon || v.glyph;
      markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([poi.lng, poi.lat]).addTo(map));
    }

    for (const m of medics) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:32px;height:32px;border-radius:10px;background:var(--caution);display:grid;place-items:center;font-size:16px;box-shadow:0 4px 10px rgba(0,0,0,0.4)";
      el.textContent = "🛡️";
      markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([m.lng, m.lat]).addTo(map));
    }
  }, [medics, pois]);

  // YOU marker (pulsing)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fix) return;
    if (!youMarkerRef.current) {
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:4px";
      if (youLabel) {
        const label = document.createElement("div");
        label.textContent = youLabel;
        label.style.cssText =
          "background:#0C1119;border:1px solid #2E9BFF;color:#fff;font-family:Manrope;font-weight:700;font-size:10px;padding:2px 7px;border-radius:999px;white-space:nowrap";
        wrap.appendChild(label);
      }
      const dot = document.createElement("div");
      dot.style.cssText =
        "width:22px;height:22px;border-radius:50%;background:#2E9BFF;border:3px solid #fff;animation:pulseDot 2s infinite";
      wrap.appendChild(dot);
      youMarkerRef.current = new maplibregl.Marker({ element: wrap }).setLngLat([fix.lng, fix.lat]).addTo(map);
    } else {
      youMarkerRef.current.setLngLat([fix.lng, fix.lat]);
    }
  }, [fix, youLabel]);

  // Recenter on demand
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fix || recenterSignal === undefined) return;
    map.flyTo({ center: [fix.lng, fix.lat], zoom: 14.5, duration: 600 });
  }, [recenterSignal, fix]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
