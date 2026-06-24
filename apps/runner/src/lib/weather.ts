/**
 * Weather data for the on-map radar + 12-hour scrubber.
 *
 *  • Live precipitation radar  → RainViewer (free, no key). Gives a list of
 *    timestamped frames (~2 h of past + ~30 min nowcast); each frame is a raster
 *    tile template MapLibre can render as an overlay.
 *  • 12-hour forecast          → Open-Meteo (free, no key). Hourly temperature,
 *    precipitation, probability and cloud cover, sampled at several points along
 *    the track so the runner sees how conditions change over the route and time.
 */

export interface RadarFrame {
  /** Unix seconds. */
  time: number;
  /** Tile template `https://…/{z}/{x}/{y}/…png` for MapLibre. */
  template: string;
}

export interface RadarData {
  frames: RadarFrame[];
  /** Index of the frame closest to "now" (last past / nowcast boundary). */
  nowIndex: number;
}

const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";

interface RainviewerResponse {
  host: string;
  radar: {
    past: Array<{ time: number; path: string }>;
    nowcast: Array<{ time: number; path: string }>;
  };
}

/** Colour scheme 4 = "Universal Blue", smooth + snow (1_1) reads well on a dark map. */
function radarTemplate(host: string, path: string): string {
  return `${host}${path}/256/{z}/{x}/{y}/4/1_1.png`;
}

export async function fetchRadar(): Promise<RadarData | null> {
  try {
    const res = await fetch(RAINVIEWER_API);
    if (!res.ok) return null;
    const data = (await res.json()) as RainviewerResponse;
    const past = data.radar?.past ?? [];
    const nowcast = data.radar?.nowcast ?? [];
    const frames = [...past, ...nowcast].map((f) => ({ time: f.time, template: radarTemplate(data.host, f.path) }));
    if (frames.length === 0) return null;
    return { frames, nowIndex: Math.max(0, past.length - 1) };
  } catch {
    return null;
  }
}

/** Pick the radar frame nearest a given unix-seconds time, or null if none is within `toleranceSec`. */
export function radarFrameAt(radar: RadarData | null, timeSec: number, toleranceSec = 20 * 60): RadarFrame | null {
  if (!radar || radar.frames.length === 0) return null;
  let best: RadarFrame | null = null;
  let bestDiff = Infinity;
  for (const f of radar.frames) {
    const diff = Math.abs(f.time - timeSec);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = f;
    }
  }
  return bestDiff <= toleranceSec ? best : null;
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
    `&hourly=temperature_2m,precipitation,precipitation_probability,cloud_cover,weather_code` +
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

/** WMO weather code → emoji + short label. */
export function weatherGlyph(code: number, cloudPct = 0): { icon: string; label: string } {
  if (code === 0) return { icon: cloudPct > 35 ? "🌤️" : "☀️", label: "Clear" };
  if (code <= 2) return { icon: "⛅", label: "Partly cloudy" };
  if (code === 3) return { icon: "☁️", label: "Overcast" };
  if (code <= 48) return { icon: "🌫️", label: "Fog" };
  if (code <= 57) return { icon: "🌦️", label: "Drizzle" };
  if (code <= 67) return { icon: "🌧️", label: "Rain" };
  if (code <= 77) return { icon: "🌨️", label: "Snow" };
  if (code <= 82) return { icon: "🌧️", label: "Showers" };
  if (code <= 86) return { icon: "🌨️", label: "Snow showers" };
  return { icon: "⛈️", label: "Thunderstorm" };
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
