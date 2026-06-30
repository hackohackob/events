/**
 * Weather data for the on-map precipitation field + 12-hour scrubber.
 *
 *  • Precipitation field → Tomorrow.io map tiles, proxied + cached by our
 *    backend (apps/backend .../weather). The client just points a raster source
 *    at a fixed URL template; the backend rations Tomorrow.io's tight request
 *    budget. See weatherTileTemplate().
 *  • 12-hour forecast    → Open-Meteo (free, no key). Hourly temperature,
 *    precipitation, probability and cloud cover, sampled at several points along
 *    the track so the runner sees how conditions change over the route and time.
 */

import { API_BASE } from "../api/client";

/**
 * Open-Meteo weather overlays. The backend fetches a coarse Bulgaria forecast
 * grid and renders small PNG overlays per field/hour (cached); the runner just
 * drops them on the map as image overlays positioned over Bulgaria — light, no
 * WASM, no tiles. See apps/backend .../weather.
 */

/** [W, S, E, N] the overlays cover — must match the backend's WEATHER_BBOX.
 *  ⚠️ TEMP DEBUG: Bulgaria + neighbours (revert to [22,41,29,44.5] for Bulgaria-only). */
export const WEATHER_BBOX: [number, number, number, number] = [20.0, 40.0, 29.0, 45.5];

/** URL of the rendered PNG overlay for a field at a forecast hour offset (0…6). */
export function weatherOverlayUrl(field: string, hour: number): string {
  return `${API_BASE}/weather/overlay/${field}/${hour}`;
}

// ─── Forecast (Open-Meteo) ────────────────────────────────────────────────────

export interface HourPoint {
  /** Unix seconds at the top of the hour. */
  time: number;
  tempC: number;
  precipMm: number;
  precipProb: number;
  cloudPct: number;
  code: number;
  /** True when the sun is up at this hour (drives sun vs moon icons). */
  isDay: boolean;
}

export interface SamplePoint {
  lat: number;
  lng: number;
  hours: HourPoint[];
}

export interface Forecast {
  /** Per-sampled-location hourly series, aligned to the same `times`. */
  points: SamplePoint[];
  /** Shared hour timestamps (unix seconds), length === HORIZON_HOURS + 1. */
  times: number[];
  /** Primary series (first point) for the headline readout & chart. */
  primary: SamplePoint;
}

export const HORIZON_HOURS = 12;

interface MeteoHourly {
  /** Unix seconds (we request `timeformat=unixtime`). */
  time: number[];
  temperature_2m: number[];
  precipitation: number[];
  precipitation_probability: number[];
  cloud_cover: number[];
  weather_code: number[];
  is_day: number[];
}
interface MeteoResult {
  latitude: number;
  longitude: number;
  hourly: MeteoHourly;
}

/**
 * Fetch a 12-hour hourly forecast for up to a handful of points (one Open-Meteo
 * call — it accepts comma-separated coordinates and returns an array). The
 * series is trimmed to [now … now+12h].
 */
export async function fetchForecast(points: Array<{ lat: number; lng: number }>): Promise<Forecast | null> {
  const pts = points.slice(0, 6);
  if (pts.length === 0) return null;
  const lat = pts.map((p) => p.lat.toFixed(4)).join(",");
  const lng = pts.map((p) => p.lng.toFixed(4)).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=temperature_2m,precipitation,precipitation_probability,cloud_cover,weather_code,is_day` +
    `&forecast_days=2&timeformat=unixtime&timezone=GMT`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const raw = await res.json();
    const results: MeteoResult[] = Array.isArray(raw) ? raw : [raw];

    const nowSec = Date.now() / 1000;
    const base = results[0]?.hourly;
    if (!base) return null;
    // First hour index at or after the current hour.
    let start = base.time.findIndex((t) => t >= nowSec - 1800);
    if (start < 0) start = 0;
    const end = Math.min(start + HORIZON_HOURS, base.time.length - 1);
    const times = base.time.slice(start, end + 1);

    const samplePoints: SamplePoint[] = results.map((r, i) => {
      const h = r.hourly;
      const hours: HourPoint[] = times.map((_, k) => {
        const idx = start + k;
        return {
          time: h.time[idx],
          tempC: h.temperature_2m[idx],
          precipMm: h.precipitation[idx] ?? 0,
          precipProb: h.precipitation_probability[idx] ?? 0,
          cloudPct: h.cloud_cover[idx] ?? 0,
          code: h.weather_code[idx] ?? 0,
          isDay: (h.is_day?.[idx] ?? 1) === 1,
        };
      });
      return { lat: pts[i]?.lat ?? r.latitude, lng: pts[i]?.lng ?? r.longitude, hours };
    });

    return { points: samplePoints, times, primary: samplePoints[0] };
  } catch {
    return null;
  }
}

// ─── Presentation helpers ─────────────────────────────────────────────────────

/** WMO weather code → emoji + i18n label key (translated by the caller). At
 *  night, clear/partly-clear skies show a moon instead of the sun. */
export function weatherGlyph(code: number, cloudPct = 0, isDay = true): { icon: string; labelKey: string } {
  if (code === 0) {
    if (!isDay) return { icon: cloudPct > 35 ? "☁️" : "🌙", labelKey: "weather.cond.clear" };
    return { icon: cloudPct > 35 ? "🌤️" : "☀️", labelKey: "weather.cond.clear" };
  }
  if (code <= 2) return { icon: isDay ? "⛅" : "☁️", labelKey: "weather.cond.partly" };
  if (code === 3) return { icon: "☁️", labelKey: "weather.cond.overcast" };
  if (code <= 48) return { icon: "🌫️", labelKey: "weather.cond.fog" };
  if (code <= 57) return { icon: "🌦️", labelKey: "weather.cond.drizzle" };
  if (code <= 67) return { icon: "🌧️", labelKey: "weather.cond.rain" };
  if (code <= 77) return { icon: "🌨️", labelKey: "weather.cond.snow" };
  if (code <= 82) return { icon: "🌧️", labelKey: "weather.cond.showers" };
  if (code <= 86) return { icon: "🌨️", labelKey: "weather.cond.snowShowers" };
  return { icon: "⛈️", labelKey: "weather.cond.thunder" };
}

/** Temperature → colour on a cold-blue → warm-red gradient (°C). */
export function tempColor(tempC: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [-10, [86, 130, 220]],
    [0, [88, 170, 230]],
    [10, [80, 200, 160]],
    [18, [120, 200, 90]],
    [24, [240, 190, 70]],
    [30, [240, 130, 60]],
    [38, [230, 70, 70]],
  ];
  if (tempC <= stops[0][0]) return rgb(stops[0][1]);
  if (tempC >= stops[stops.length - 1][0]) return rgb(stops[stops.length - 1][1]);
  for (let i = 1; i < stops.length; i += 1) {
    if (tempC <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (tempC - t0) / (t1 - t0);
      return rgb([
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ]);
    }
  }
  return rgb(stops[stops.length - 1][1]);
}

function rgb([r, g, b]: [number, number, number]): string {
  return `rgb(${r},${g},${b})`;
}

export function fmtHour(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
