import { useEffect, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import type { PublicMedicState } from "../api/contracts-shim";
import type { Fix } from "../hooks/useGeolocation";
import type { PoiLike } from "../api";
import { haversineMeters } from "../lib/geo";
import { OSM_TILE_URL } from "../lib/offline-map";
import { tempColor, WEATHER_BBOX } from "../lib/weather";

// Image-overlay corner coordinates (top-left, top-right, bottom-right, bottom-left)
// for the Bulgaria weather overlays, from the [W,S,E,N] bbox.
const WX_COORDS: [[number, number], [number, number], [number, number], [number, number]] = [
  [WEATHER_BBOX[0], WEATHER_BBOX[3]],
  [WEATHER_BBOX[2], WEATHER_BBOX[3]],
  [WEATHER_BBOX[2], WEATHER_BBOX[1]],
  [WEATHER_BBOX[0], WEATHER_BBOX[1]],
];

export interface WeatherPoint {
  lng: number;
  lat: number;
  tempC: number;
  precipMm: number;
  precipProb: number;
  cloudPct: number;
  primary?: boolean;
}

// Fence the camera to the overlay area: pan is clamped to the rendered bbox
// (maxBounds) so you can't scroll onto blank map, and zoom is bounded. ⚠️ TEMP
// DEBUG band; for Bulgaria-only use ~6 / 11 / 7.
const WEATHER_MIN_ZOOM = 5; // floor (maxBounds usually raises the effective min)
const WEATHER_MAX_ZOOM = 13; // hard zoom-in cap
const WEATHER_VIEW_ZOOM = 6.5; // fallback target on entry when there's no track
const WEATHER_ENTRY_MAXZOOM = 9; // on entry, frame the track but don't zoom past this
const DEFAULT_MAX_ZOOM = 19; // restored when leaving weather mode
const DEFAULT_MIN_ZOOM = 0; // restored when leaving weather mode
/** Pan limit while weather is open — the rendered overlay bbox [[W,S],[E,N]]. */
const WEATHER_MAX_BOUNDS: [[number, number], [number, number]] = [
  [WEATHER_BBOX[0], WEATHER_BBOX[1]],
  [WEATHER_BBOX[2], WEATHER_BBOX[3]],
];

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      // Same template offline packs cache, so cached tiles resolve 1:1.
      tiles: [OSM_TILE_URL],
      tileSize: 256,
      attribution: "© OpenStreetMap",
    },
    satellite: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "© Esri",
    },
  },
  layers: [
    { id: "osm", type: "raster", source: "osm" },
    { id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } },
  ],
};

interface Props {
  coords: [number, number][] | null;
  routeColor: string;
  medics: PublicMedicState[];
  pois: PoiLike[];
  fix: Fix | null;
  youLabel?: string;
  recenterSignal?: number;
  compassSignal?: number;
  fitSignal?: number;
  satellite?: boolean;
  scrubPoint?: [number, number] | null;
  /** Open-Meteo weather image overlays (Bulgaria PNGs), drawn under the route in
   *  list order (bottom→top). Every forecast hour for both fields is passed at
   *  once and kept loaded; the scrubbed hour has opacity 1, the rest 0 — so
   *  scrubbing is an instant opacity swap with no reload. An empty list removes
   *  them all (leaving the weather view). */
  weatherLayers?: Array<{ id: string; url: string; opacity?: number }>;
  /** Forecast temperature points to show along the route, or null to hide. */
  weatherPoints?: WeatherPoint[] | null;
  /** Weather mode: lock the camera around the low tile zoom — block zooming in
   *  past the tile resolution, and clamp zoom-out to the regional level (Balkans,
   *  not the whole continent) — and pull back a little on entry. */
  weatherMode?: boolean;
  /** Px occluded at the bottom (sheet/dock) — fed to the map as camera padding
   *  so "centre", recenter and fitBounds frame content in the *visible* area. */
  bottomInset?: number;
  /** Px reserved at the top (header). */
  topInset?: number;
  interactive?: boolean;
  /** Editable incident pin (Confirm screen): initial position. */
  editablePin?: [number, number] | null;
  pinMaxMeters?: number;
  onPinMove?: (lngLat: [number, number]) => void;
  /** When false the pin is shown but not draggable (static preview). */
  pinDraggable?: boolean;
  /** Clamp centre for the drag radius — defaults to the pin's start position.
   *  Pass the original GPS fix so re-adjusting still clamps from the true point. */
  pinClampCenter?: [number, number] | null;
}

function poiVisual(type: string): { bg: string; glyph: string } | null {
  const t = type.toLowerCase();
  if (/tent|camp|hospital|medical|aid/.test(t)) return { bg: "#FFFFFF", glyph: "✚" };
  if (/water|hydrat/.test(t)) return { bg: "#2E9BFF", glyph: "💧" };
  return null;
}

/** Single self-contained SVG marker (no nested positioning — that's what made
 *  markers drift on zoom). Green, grey when resting, blue arrow badge drawn
 *  inside the SVG when the medic is moving. */
function medicMarkerEl(status: string): HTMLElement {
  const resting = status === "rest" || status === "stationary";
  const color = resting ? "#5A6B7E" : "#18B883";
  const moving = status === "going_to";
  const el = document.createElement("div");
  el.style.width = "38px";
  el.style.height = "48px";
  el.innerHTML = `
    <svg width="38" height="48" viewBox="0 0 38 48" xmlns="http://www.w3.org/2000/svg"
         style="filter:drop-shadow(0 4px 6px rgba(0,0,0,0.45))">
      <path d="M19 2C9.6 2 2 9.4 2 18.6 2 30.6 19 46 19 46s17-15.4 17-27.4C36 9.4 28.4 2 19 2Z"
            fill="${color}" stroke="#fff" stroke-width="2"/>
      <circle cx="19" cy="18.6" r="12" fill="#fff"/>
      <path d="M16.3 11h5.4v4.9h4.9v5.4h-4.9v4.9h-5.4v-4.9h-4.9v-5.4h4.9z" fill="${color}"/>
      ${
        moving
          ? `<circle cx="31" cy="8" r="7.5" fill="#2E9BFF" stroke="#fff" stroke-width="2"/>
             <text x="31" y="11.5" text-anchor="middle" font-size="10" fill="#fff" font-weight="bold">↗</text>`
          : ""
      }
    </svg>`;
  return el;
}

export function RunnerMap({
  coords,
  routeColor,
  medics,
  pois,
  fix,
  youLabel,
  recenterSignal,
  compassSignal,
  fitSignal,
  satellite,
  scrubPoint,
  weatherLayers,
  weatherPoints,
  weatherMode = false,
  bottomInset = 0,
  topInset = 0,
  interactive = true,
  editablePin,
  pinMaxMeters = 500,
  onPinMove,
  pinDraggable = true,
  pinClampCenter,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const youMarkerRef = useRef<maplibregl.Marker | null>(null);
  const scrubMarkerRef = useRef<maplibregl.Marker | null>(null);
  const pinMarkerRef = useRef<maplibregl.Marker | null>(null);
  const pinOriginRef = useRef<[number, number] | null>(null);
  const weatherMarkersRef = useRef<maplibregl.Marker[]>([]);
  // Weather image-overlay ids we've created (to remove on close) + the last image
  // url set on each (so we only swap the image when the scrubbed hour changes).
  const weatherLayerIdsRef = useRef<Set<string>>(new Set());
  const weatherUrlRef = useRef<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const fittedRef = useRef(false);
  const centeredOnFixRef = useRef(false);
  // Latest fix without re-triggering the recenter effect on every GPS update.
  const fixRef = useRef<Fix | null>(fix);
  fixRef.current = fix;
  // Latest camera insets, read by fitBounds without re-fitting on every drag px.
  const insetRef = useRef({ top: topInset, bottom: bottomInset });
  insetRef.current = { top: topInset, bottom: bottomInset };
  const fitPad = () => ({
    top: insetRef.current.top + 40,
    bottom: insetRef.current.bottom + 40,
    left: 28,
    right: 28,
  });

  // Init
  useEffect(() => {
    if (!containerRef.current) return;
    const center: [number, number] = editablePin
      ? editablePin
      : fix
        ? [fix.lng, fix.lat]
        : coords && coords.length
          ? coords[Math.floor(coords.length / 2)]
          : [23.32, 42.7];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center,
      zoom: editablePin ? 15.5 : 13.5,
      attributionControl: false,
      interactive,
    });
    mapRef.current = map;
    if (fix) centeredOnFixRef.current = true;
    map.on("load", () => {
      map.getCanvas().style.filter = satellite ? "none" : "var(--map-filter)";
      setReady(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
      // The map (and all its markers) are gone — drop the single-instance marker
      // refs so they're recreated on the next mount (StrictMode / remount safe).
      youMarkerRef.current = null;
      scrubMarkerRef.current = null;
      pinMarkerRef.current = null;
      markersRef.current = [];
      fittedRef.current = false;
      centeredOnFixRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw / update route — runs once the map is ready and whenever coords change,
  // so it can't lose a coords update that arrived before load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !coords || coords.length < 2) return;
    const data = {
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: coords },
      properties: {},
    };
    const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    } else {
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
    }
    map.setPaintProperty("route-line", "line-color", routeColor);
    if (!fittedRef.current && !fix && !editablePin) {
      map.fitBounds(routeBounds(coords), { padding: fitPad(), maxZoom: 14, duration: 0 });
      fittedRef.current = true;
    }
  }, [ready, coords, routeColor, fix, editablePin]);

  // Satellite toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty("satellite", "visibility", satellite ? "visible" : "none");
    map.getCanvas().style.filter = satellite ? "none" : "var(--map-filter)";
  }, [satellite, ready]);

  // Medic + POI markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    for (const poi of pois) {
      const v = poiVisual(poi.type);
      if (!v) continue;
      const el = document.createElement("div");
      el.style.cssText = `width:28px;height:28px;border-radius:50%;background:${v.bg};display:grid;place-items:center;font-size:14px;border:2px solid ${v.bg === "#FFFFFF" ? "var(--critical)" : "rgba(255,255,255,0.7)"};box-shadow:0 2px 6px rgba(0,0,0,0.4);color:${v.bg === "#FFFFFF" ? "var(--critical)" : "#fff"}`;
      el.textContent = v.glyph;
      markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([poi.lng, poi.lat]).addTo(map));
    }
    for (const m of medics) {
      markersRef.current.push(
        new maplibregl.Marker({ element: medicMarkerEl(m.status), anchor: "bottom" })
          .setLngLat([m.lng, m.lat])
          .addTo(map),
      );
    }
  }, [medics, pois]);

  // YOU marker (pulsing) — recenter the first time a fix arrives.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fix || editablePin) return;
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
      dot.style.cssText = "width:22px;height:22px;border-radius:50%;background:#2E9BFF;border:3px solid #fff;animation:pulseDot 2s infinite";
      wrap.appendChild(dot);
      youMarkerRef.current = new maplibregl.Marker({ element: wrap }).setLngLat([fix.lng, fix.lat]).addTo(map);
    } else {
      youMarkerRef.current.setLngLat([fix.lng, fix.lat]);
    }
    if (!centeredOnFixRef.current) {
      centeredOnFixRef.current = true;
      map.flyTo({ center: [fix.lng, fix.lat], zoom: 14.5, duration: 600 });
    }
  }, [fix, youLabel, editablePin]);

  // Editable incident pin (draggable, clamped to pinMaxMeters from origin).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !editablePin) return;
    if (!pinMarkerRef.current) {
      // Clamp from the original GPS point when given, else from the start pin.
      pinOriginRef.current = pinClampCenter ?? editablePin;
      const el = document.createElement("div");
      el.style.width = "30px";
      el.style.height = "40px";
      el.innerHTML = `<svg width="30" height="40" viewBox="0 0 30 40" style="filter:drop-shadow(0 3px 5px rgba(0,0,0,0.5))">
        <path d="M15 1C7.8 1 2 6.6 2 13.6 2 23 15 39 15 39s13-16 13-25.4C28 6.6 22.2 1 15 1Z" fill="#E63946" stroke="#fff" stroke-width="2"/>
        <circle cx="15" cy="14" r="5" fill="#fff"/></svg>`;
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom", draggable: pinDraggable })
        .setLngLat(editablePin)
        .addTo(map);
      marker.on("drag", () => {
        const ll = marker.getLngLat();
        const origin = pinOriginRef.current!;
        const d = haversineMeters({ lng: origin[0], lat: origin[1] }, { lng: ll.lng, lat: ll.lat });
        if (d > pinMaxMeters) {
          const f = pinMaxMeters / d;
          const clamped: [number, number] = [origin[0] + (ll.lng - origin[0]) * f, origin[1] + (ll.lat - origin[1]) * f];
          marker.setLngLat(clamped);
        }
      });
      marker.on("dragend", () => {
        const ll = marker.getLngLat();
        onPinMove?.([ll.lng, ll.lat]);
      });
      pinMarkerRef.current = marker;
    } else if (!pinDraggable) {
      // Static preview (Confirm thumbnail): when the pin is re-positioned (after
      // "fix location"), move the marker AND re-centre so the image updates.
      pinMarkerRef.current.setLngLat(editablePin);
      map.setCenter(editablePin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editablePin, pinDraggable]);

  // Allowed-radius circle for the editable pin (only while it's draggable).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !editablePin || !pinDraggable) return;
    const circle = circlePolygon(pinClampCenter ?? editablePin, pinMaxMeters);
    const src = map.getSource("pin-radius") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(circle);
    } else {
      map.addSource("pin-radius", { type: "geojson", data: circle });
      map.addLayer({ id: "pin-radius-fill", type: "fill", source: "pin-radius", paint: { "fill-color": "#E63946", "fill-opacity": 0.08 } });
      map.addLayer({ id: "pin-radius-line", type: "line", source: "pin-radius", paint: { "line-color": "#E63946", "line-width": 1.5, "line-dasharray": [2, 2] } });
    }
  }, [ready, editablePin, pinMaxMeters]);

  // Scrubber marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!scrubPoint) {
      scrubMarkerRef.current?.remove();
      scrubMarkerRef.current = null;
      return;
    }
    if (!scrubMarkerRef.current) {
      const el = document.createElement("div");
      el.style.cssText = "width:18px;height:18px;border-radius:50%;background:#fff;border:3px solid #2BE3A0;box-shadow:0 2px 8px rgba(0,0,0,0.5)";
      scrubMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat(scrubPoint).addTo(map);
    } else {
      scrubMarkerRef.current.setLngLat(scrubPoint);
    }
    // Keep the scrubbed point visible: if it falls outside the current viewport,
    // zoom out (fit the current view extended to include it) rather than yanking
    // the camera off the runner. Padded for the header + sheet so it lands in the
    // visible area.
    if (!map.getBounds().contains(scrubPoint)) {
      const bounds = map.getBounds().extend(scrubPoint);
      map.fitBounds(bounds, { padding: fitPad(), duration: 300, maxZoom: map.getZoom() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrubPoint]);

  // Recenter ONLY when the button is pressed (recenterSignal changes) — not on
  // every GPS update. Reading the fix from a ref keeps the map free to pan so
  // the runner can look around the course without being yanked back.
  useEffect(() => {
    const map = mapRef.current;
    const f = fixRef.current;
    if (!map || !f || !recenterSignal) return; // recenterSignal 0/undefined = no-op
    map.flyTo({ center: [f.lng, f.lat], zoom: 14.5, duration: 600 });
  }, [recenterSignal]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || compassSignal === undefined) return;
    map.easeTo({ bearing: 0, pitch: 0, duration: 400 });
  }, [compassSignal]);

  // Fit to the full track (e.g. when Track Studio opens) — framed into the
  // visible area above the sheet via the current bottom inset.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fitSignal === undefined || !coords || coords.length < 2) return;
    map.fitBounds(routeBounds(coords), { padding: fitPad(), maxZoom: 15, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal, coords]);

  // Camera padding — animate the visible centre up/down as the bottom sheet or
  // dock grows/shrinks, so the route never hides behind it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.easeTo({ padding: { top: topInset, bottom: bottomInset, left: 0, right: 0 }, duration: 300 });
  }, [topInset, bottomInset, ready]);

  // Open-Meteo weather image overlays (Bulgaria PNGs), under the route. Every
  // forecast hour for both fields is added at once (so they all load on open); the
  // scrubbed hour is opaque, the rest transparent — scrubbing just swaps raster-
  // opacity, so there's no reload glitch. An empty list (leaving weather) removes
  // them all so they stop loading.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const layers = weatherLayers ?? [];
    const wanted = new Set(layers.map((l) => l.id));

    // Remove any weather layer no longer wanted (close).
    for (const id of [...weatherLayerIdsRef.current]) {
      if (!wanted.has(id)) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
        weatherLayerIdsRef.current.delete(id);
      }
    }

    // Add/update in list order so later layers (precip) sit above earlier ones
    // (clouds), both below the route casing. Scrubbing changes the url → swap the
    // image in place (updateImage) rather than re-adding the layer.
    for (const { id, url, opacity = 0 } of layers) {
      const src = map.getSource(id) as maplibregl.ImageSource | undefined;
      if (!src) {
        map.addSource(id, { type: "image", url, coordinates: WX_COORDS });
        const before = map.getLayer("route-casing") ? "route-casing" : undefined;
        map.addLayer(
          {
            id,
            type: "raster",
            source: id,
            paint: { "raster-opacity": opacity, "raster-opacity-transition": { duration: 0 }, "raster-fade-duration": 0 },
          },
          before,
        );
        weatherLayerIdsRef.current.add(id);
        weatherUrlRef.current[id] = url;
      } else {
        if (weatherUrlRef.current[id] !== url) {
          src.updateImage({ url, coordinates: WX_COORDS });
          weatherUrlRef.current[id] = url;
        }
        map.setPaintProperty(id, "raster-opacity", opacity);
      }
    }
  }, [weatherLayers, ready]);

  // Weather mode: clamp panning to the rendered overlay bbox (maxBounds) so you
  // can't scroll onto blank map, bound the zoom, and pull back on entry. Restore
  // the free camera on exit.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (weatherMode) {
      map.setMinZoom(WEATHER_MIN_ZOOM);
      map.setMaxZoom(WEATHER_MAX_ZOOM);
      map.setMaxBounds(WEATHER_MAX_BOUNDS);
      // Frame the track on entry (a bit zoomed in, capped so there's still weather
      // context around it). No track → fall back to a regional zoom.
      if (coords && coords.length > 1) {
        map.fitBounds(routeBounds(coords), { padding: fitPad(), maxZoom: WEATHER_ENTRY_MAXZOOM, duration: 600 });
      } else if (Math.abs(map.getZoom() - WEATHER_VIEW_ZOOM) > 0.05) {
        map.easeTo({ zoom: WEATHER_VIEW_ZOOM, duration: 500 });
      }
    } else {
      map.setMaxBounds(null);
      map.setMinZoom(DEFAULT_MIN_ZOOM);
      map.setMaxZoom(DEFAULT_MAX_ZOOM);
    }
    // Only re-run when entering/leaving weather (coords is read once on entry).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherMode, ready]);

  // Forecast temperature points along the route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    weatherMarkersRef.current.forEach((m) => m.remove());
    weatherMarkersRef.current = [];
    if (!weatherPoints) return;
    for (const p of weatherPoints) {
      const c = tempColor(p.tempC);
      const el = document.createElement("div");
      el.style.cssText = [
        "display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px",
        `background:${c};color:#06121d;font-family:Archivo,sans-serif`,
        `font-weight:800;font-size:${p.primary ? 14 : 12}px;white-space:nowrap`,
        "border:2px solid rgba(255,255,255,0.9);box-shadow:0 3px 8px rgba(0,0,0,0.45)",
      ].join(";");
      el.textContent = `${Math.round(p.tempC)}°${p.precipMm >= 0.1 ? " 💧" : ""}`;
      weatherMarkersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map),
      );
    }
  }, [weatherPoints]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}

function routeBounds(coords: [number, number][]): maplibregl.LngLatBounds {
  return coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
}

function circlePolygon([lng, lat]: [number, number], radiusM: number) {
  const pts: [number, number][] = [];
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    pts.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [pts] }, properties: {} };
}
