import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PNG } from "pngjs";

/**
 * Lightweight weather overlays for the runner map, from **Open-Meteo** (free,
 * key-less). Rather than ship a heavy client (the `om://` WASM layer Range-reads
 * 160 MB model files), we keep all the work server-side and small:
 *
 *  1. Fetch the next few hours of precipitation + cloud cover on a coarse grid
 *     over **Bulgaria** in a single Open-Meteo call (~140 KB), cached.
 *  2. Render a small, smooth PNG overlay per field/hour (bilinear-interpolated +
 *     coloured), cached with expiry.
 *
 * The PWA then just drops these as plain MapLibre image overlays over the Bulgaria
 * bounding box — no WASM, no tiles, no Range requests. Cutting the grid/image
 * resolution keeps it cheap; the field is coarse weather anyway.
 */

// ⚠️ TEMPORARY DEBUG CONFIG — wide Balkans/SE-Europe area + 20 h, so we can scrub
// ahead and see where/how rain renders. Kept to ONE Open-Meteo call (≤450 pts ×
// 2 days) to stay under the free minutely limit, and a render blur smooths the
// coarse grid so it doesn't look like big diamonds. Revert to the light Bulgaria-
// only production values:
//   GRID { west:22, east:29, south:41, north:44.5, step:0.5 }, HORIZON_HOURS 6,
//   IMG 256×128, FORECAST_DAYS 2 (or 1), BLUR_RADIUS small.
// Grid is step° spacing, row-major (latIdx * nLon + lonIdx), latIdx 0 = south.
const GRID = { west: 20.0, east: 29.0, south: 40.0, north: 45.5, step: 0.25 };
const HORIZON_HOURS = 20;
const FORECAST_DAYS = 2; // must cover now + HORIZON_HOURS
const IMG_W = 720; // ≈ bbox aspect (9° × 5.5°)
const IMG_H = 440;
/** Smooth the bilinear field so a coarse grid renders as blobs, not diamonds. */
const BLUR_RADIUS = 10;
/** Open-Meteo caps a GET at ~550 locations (URL length); batch if a grid exceeds. */
const FETCH_CHUNK = 450;

/** [W,S,E,N] — the area the overlays cover (the client positions the image here). */
export const WEATHER_BBOX: [number, number, number, number] = [GRID.west, GRID.south, GRID.east, GRID.north];

const FIELDS = new Set(["precipitation", "cloud_cover"]);

interface GridData {
  nLat: number;
  nLon: number;
  /** Per location (row-major), the hourly values now…now+HORIZON. */
  precip: number[][];
  cloud: number[][];
  fetchedAt: number;
}

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);

  private grid: GridData | null = null;
  private gridInflight: Promise<GridData | null> | null = null;
  private readonly gridTtlMs = Number(process.env.WEATHER_GRID_TTL_MS ?? 20 * 60_000);

  private readonly overlayCache = new Map<string, { buf: Buffer; expiresAt: number }>();
  private readonly overlayTtlMs = Number(process.env.WEATHER_OVERLAY_TTL_MS ?? 20 * 60_000);

  constructor() {
    const timer = setInterval(() => this.sweep(), 10 * 60_000);
    (timer as { unref?: () => void }).unref?.();
  }

  get horizonHours(): number {
    return HORIZON_HOURS;
  }

  /** Rendered PNG overlay for `field` at `hourOffset` (0…HORIZON). Cached. */
  async getOverlay(field: string, hourOffset: number): Promise<Buffer> {
    if (!FIELDS.has(field)) throw new BadRequestException(`Unsupported field: ${field}`);
    const h = Math.max(0, Math.min(HORIZON_HOURS, Math.floor(hourOffset)));

    const grid = await this.ensureGrid();
    if (!grid) return this.transparent();

    // Key includes the grid's fetch time so a refreshed grid invalidates overlays.
    const key = `${field}/${h}/${grid.fetchedAt}`;
    const hit = this.overlayCache.get(key);
    if (hit && Date.now() < hit.expiresAt) return hit.buf;

    const buf = this.render(grid, field, h);
    this.overlayCache.set(key, { buf, expiresAt: Date.now() + this.overlayTtlMs });
    return buf;
  }

  // ── Grid fetch (cached, deduped) ──────────────────────────────────────────

  private async ensureGrid(): Promise<GridData | null> {
    if (this.grid && Date.now() - this.grid.fetchedAt < this.gridTtlMs) return this.grid;
    if (this.gridInflight) return this.gridInflight;
    this.gridInflight = this.fetchGrid().finally(() => {
      this.gridInflight = null;
    });
    const fresh = await this.gridInflight;
    if (fresh) this.grid = fresh;
    return fresh ?? this.grid; // fall back to a stale grid on transient failure
  }

  private async fetchGrid(): Promise<GridData | null> {
    const lats: string[] = [];
    const lons: string[] = [];
    let nLat = 0;
    let nLon = 0;
    for (let la = GRID.south; la <= GRID.north + 1e-6; la += GRID.step) {
      nLat += 1;
      nLon = 0;
      for (let lo = GRID.west; lo <= GRID.east + 1e-6; lo += GRID.step) {
        lats.push(la.toFixed(2));
        lons.push(lo.toFixed(2));
        nLon += 1;
      }
    }
    // Batch into ≤FETCH_CHUNK locations per call (Open-Meteo GET URL length cap),
    // concatenating results in order so they stay row-major.
    try {
      const results: Array<{ hourly: { time: number[]; precipitation: number[]; cloud_cover: number[] } }> = [];
      for (let i = 0; i < lats.length; i += FETCH_CHUNK) {
        const la = lats.slice(i, i + FETCH_CHUNK).join(",");
        const lo = lons.slice(i, i + FETCH_CHUNK).join(",");
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}` +
          `&hourly=precipitation,cloud_cover&forecast_days=${FORECAST_DAYS}&timeformat=unixtime&timezone=GMT`;
        const res = await fetch(url);
        if (!res.ok) {
          this.logger.warn(`Open-Meteo grid chunk → ${res.status}`);
          return null;
        }
        const raw = (await res.json()) as typeof results | (typeof results)[number];
        for (const loc of Array.isArray(raw) ? raw : [raw]) results.push(loc);
      }
      const time = results[0]?.hourly?.time;
      if (!time?.length) return null;
      const nowSec = Date.now() / 1000;
      let start = time.findIndex((t) => t >= nowSec - 1800);
      if (start < 0) start = 0;
      start = Math.min(start, time.length - 1 - HORIZON_HOURS);
      if (start < 0) start = 0;

      const precip: number[][] = [];
      const cloud: number[][] = [];
      for (const loc of results) {
        const h = loc.hourly;
        precip.push(h.precipitation.slice(start, start + HORIZON_HOURS + 1));
        cloud.push(h.cloud_cover.slice(start, start + HORIZON_HOURS + 1));
      }
      return { nLat, nLon, precip, cloud, fetchedAt: Date.now() };
    } catch (error) {
      this.logger.warn(`Open-Meteo grid failed: ${(error as Error).message}`);
      return null;
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private render(grid: GridData, field: string, hour: number): Buffer {
    const png = new PNG({ width: IMG_W, height: IMG_H });
    const values = field === "precipitation" ? grid.precip : grid.cloud;
    const color = field === "precipitation" ? precipColor : cloudColor;

    // 1) Bilinear-sample the grid into a per-pixel value field.
    let f: Float32Array = new Float32Array(IMG_W * IMG_H);
    for (let py = 0; py < IMG_H; py += 1) {
      const lat = GRID.north - (py / (IMG_H - 1)) * (GRID.north - GRID.south);
      for (let px = 0; px < IMG_W; px += 1) {
        const lon = GRID.west + (px / (IMG_W - 1)) * (GRID.east - GRID.west);
        f[py * IMG_W + px] = this.bilinear(grid, values, lat, lon, hour);
      }
    }
    // 2) Blur so the coarse grid reads as smooth blobs, not diamonds.
    if (BLUR_RADIUS > 0) f = boxBlur(f, IMG_W, IMG_H, BLUR_RADIUS, 2);
    // 3) Colour.
    for (let i = 0; i < f.length; i += 1) {
      const [r, g, b, a] = color(f[i]);
      const idx = i * 4;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
    return PNG.sync.write(png);
  }

  /** Bilinear sample of `values[loc][hour]` at (lat, lon). */
  private bilinear(grid: GridData, values: number[][], lat: number, lon: number, hour: number): number {
    const { nLat, nLon } = grid;
    let laf = (lat - GRID.south) / GRID.step;
    let lof = (lon - GRID.west) / GRID.step;
    laf = Math.max(0, Math.min(nLat - 1, laf));
    lof = Math.max(0, Math.min(nLon - 1, lof));
    const i0 = Math.floor(laf);
    const j0 = Math.floor(lof);
    const i1 = Math.min(i0 + 1, nLat - 1);
    const j1 = Math.min(j0 + 1, nLon - 1);
    const fa = laf - i0;
    const fb = lof - j0;
    const at = (i: number, j: number) => values[i * nLon + j]?.[hour] ?? 0;
    const top = at(i0, j0) + (at(i0, j1) - at(i0, j0)) * fb;
    const bot = at(i1, j0) + (at(i1, j1) - at(i1, j0)) * fb;
    return top + (bot - top) * fa;
  }

  private transparent(): Buffer {
    return PNG.sync.write(new PNG({ width: IMG_W, height: IMG_H }));
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, e] of this.overlayCache) if (now >= e.expiresAt) this.overlayCache.delete(k);
  }
}

// ── Image helpers ─────────────────────────────────────────────────────────────

/** Separable box blur over a W×H float field, `passes` times (≈ Gaussian). */
function boxBlur(src: Float32Array, w: number, h: number, radius: number, passes: number): Float32Array {
  let a: Float32Array = src;
  let b: Float32Array = new Float32Array(a.length);
  const win = radius * 2 + 1;
  for (let p = 0; p < passes; p += 1) {
    // Horizontal.
    for (let y = 0; y < h; y += 1) {
      const row = y * w;
      let sum = 0;
      for (let x = -radius; x <= radius; x += 1) sum += a[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x += 1) {
        b[row + x] = sum / win;
        sum += a[row + clamp(x + radius + 1, 0, w - 1)] - a[row + clamp(x - radius, 0, w - 1)];
      }
    }
    [a, b] = [b, a];
    // Vertical.
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let y = -radius; y <= radius; y += 1) sum += a[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y += 1) {
        b[y * w + x] = sum / win;
        sum += a[clamp(y + radius + 1, 0, h - 1) * w + x] - a[clamp(y - radius, 0, h - 1) * w + x];
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── Colour scales ─────────────────────────────────────────────────────────────

type RGBA = [number, number, number, number];

/** Radar-style precipitation colours (mm/h). Transparent when dry. */
function precipColor(mm: number): RGBA {
  if (mm < 0.05) return [0, 0, 0, 0];
  const stops: Array<[number, RGBA]> = [
    [0.1, [120, 180, 255, 90]],
    [1, [40, 120, 255, 150]],
    [3, [0, 200, 160, 180]],
    [6, [235, 220, 50, 205]],
    [12, [250, 140, 30, 220]],
    [25, [230, 40, 40, 235]],
  ];
  return rampColor(mm, stops);
}

/** Soft grey veil for cloud cover (%). */
function cloudColor(pct: number): RGBA {
  if (pct < 5) return [0, 0, 0, 0];
  const a = Math.round(Math.min(1, pct / 100) * 130); // up to ~0.5 so the map shows through
  return [205, 212, 224, a];
}

function rampColor(v: number, stops: Array<[number, RGBA]>): RGBA {
  if (v <= stops[0][0]) return stops[0][1];
  if (v >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 1; i < stops.length; i += 1) {
    if (v <= stops[i][0]) {
      const [v0, c0] = stops[i - 1];
      const [v1, c1] = stops[i];
      const f = (v - v0) / (v1 - v0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
        Math.round(c0[3] + (c1[3] - c0[3]) * f),
      ];
    }
  }
  return stops[stops.length - 1][1];
}
