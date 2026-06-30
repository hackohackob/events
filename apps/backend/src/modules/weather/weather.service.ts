import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { promises as fs, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";

/**
 * Lightweight weather overlays for the runner map, from **Open-Meteo** (free,
 * key-less). Rather than ship a heavy client (the `om://` WASM layer Range-reads
 * 160 MB model files), we keep all the work server-side and small:
 *
 *  1. Fetch the next ~12 h of precipitation + cloud cover on a coarse grid over
 *     Bulgaria and the surrounding Balkans, batched into a few Open-Meteo calls,
 *     cached (and persisted to disk so restarts stay warm).
 *  2. Render a small, smooth PNG overlay per field/hour (bilinear-interpolated +
 *     coloured), cached with expiry.
 *
 * The PWA then just drops these as plain MapLibre image overlays over the bbox —
 * no WASM, no tiles, no Range requests. The coarse grid + render blur keep it
 * cheap; the field is coarse weather anyway.
 */

// Grid covers Bulgaria + the surrounding Balkans/SE-Europe so the client can scrub
// the forecast across the whole visible map. The fine 0.2° spacing (~1.3k points)
// is batched into ≤FETCH_CHUNK-location Open-Meteo calls, and a render blur
// (BLUR_RADIUS) smooths the coarse field so it reads as blobs, not diamonds.
// Grid is step° spacing, row-major (latIdx * nLon + lonIdx), latIdx 0 = south.
// 0.35° keeps the WHOLE grid (~416 points) inside a SINGLE Open-Meteo call
// (≤FETCH_CHUNK) — multiple back-to-back calls are what trip the per-minute
// limit and leave the overlay perpetually blank. The render blur (BLUR_RADIUS)
// hides the coarse spacing so it still reads as smooth blobs.
const GRID = { west: 20.0, east: 29.0, south: 40.0, north: 45.5, step: 0.35 };
const HORIZON_HOURS = 12;
/** Request only the hours we scrub (+ margin) — far lighter than whole days. */
const FORECAST_HOURS = HORIZON_HOURS + 2;
const IMG_W = 880; // ≈ bbox aspect (9° × 5.5°)
const IMG_H = 536;
/** Smooth the bilinear field so the coarse grid renders as blobs, not diamonds. */
const BLUR_RADIUS = 14;
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

  /** Per-request timeout so a stalled socket can't wedge `gridInflight` forever. */
  private readonly fetchTimeoutMs = Number(process.env.WEATHER_FETCH_TIMEOUT_MS ?? 8_000);
  /** After a failed fetch (e.g. 429) back off until this, instead of re-firing on
   *  every request — otherwise a busy client machine-guns Open-Meteo and stays limited. */
  private cooldownUntil = 0;
  private readonly failCooldownMs = Number(process.env.WEATHER_FAIL_COOLDOWN_MS ?? 60_000);

  /** Last-good grid is persisted here so a restart within the TTL is warm (no cold
   *  fetch storm). Small JSON (~200 KB); defaults to the OS temp dir. */
  private readonly cacheFile = process.env.WEATHER_GRID_CACHE_FILE ?? join(tmpdir(), "events-weather-grid.json");

  private readonly overlayCache = new Map<string, { buf: Buffer; expiresAt: number }>();
  private readonly overlayTtlMs = Number(process.env.WEATHER_OVERLAY_TTL_MS ?? 20 * 60_000);

  constructor() {
    this.loadPersistedGrid();
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
    // Recently failed (rate-limited / network): serve stale (or null) quietly until the
    // cooldown lapses, rather than re-firing a heavy fetch on every request.
    if (Date.now() < this.cooldownUntil) return this.grid;
    this.gridInflight = this.fetchGrid().finally(() => {
      this.gridInflight = null;
    });
    const fresh = await this.gridInflight;
    if (fresh) {
      this.grid = fresh;
      void this.persistGrid(fresh);
    }
    return fresh ?? this.grid; // fall back to a stale grid on transient failure
  }

  // ── Disk persistence (warm restarts) ──────────────────────────────────────

  /** Seed `this.grid` from the last-good file, but only if still within the TTL —
   *  an older grid's hourly slices no longer line up with "now", so we'd rather
   *  refetch than show stale weather as current. Best-effort; ignores any error. */
  private loadPersistedGrid(): void {
    try {
      const g = JSON.parse(readFileSync(this.cacheFile, "utf8")) as GridData;
      const ok =
        typeof g?.fetchedAt === "number" &&
        Number.isFinite(g.nLat) &&
        Number.isFinite(g.nLon) &&
        Array.isArray(g.precip) &&
        Array.isArray(g.cloud) &&
        g.precip.length === g.nLat * g.nLon;
      const age = ok ? Date.now() - g.fetchedAt : Infinity;
      if (ok && age >= 0 && age < this.gridTtlMs) {
        this.grid = g;
        this.logger.log(`Loaded persisted weather grid (${Math.round(age / 1000)}s old)`);
      }
    } catch {
      // No cache yet / unreadable — fine, we fetch on first request.
    }
  }

  /** Write atomically (tmp + rename) so a crash mid-write can't leave a torn file. */
  private async persistGrid(grid: GridData): Promise<void> {
    try {
      const tmp = `${this.cacheFile}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(grid));
      await fs.rename(tmp, this.cacheFile);
    } catch (error) {
      this.logger.warn(`Failed to persist weather grid: ${(error as Error).message}`);
    }
  }

  /** `fetch` with an abort timeout — Node's fetch has none, so a stalled connection
   *  would otherwise hang `gridInflight` indefinitely and wedge the whole service. */
  private async fetchWithTimeout(url: string): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.fetchTimeoutMs);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Back off after a failed fetch. Honours a 429 `Retry-After` when present. */
  private startCooldown(res?: Response): void {
    const ra = res ? Number(res.headers.get("retry-after")) : NaN;
    const ms = res?.status === 429 && Number.isFinite(ra) && ra > 0 ? ra * 1000 : this.failCooldownMs;
    this.cooldownUntil = Date.now() + ms;
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
          `&hourly=precipitation,cloud_cover&forecast_hours=${FORECAST_HOURS}&timeformat=unixtime&timezone=GMT`;
        const res = await this.fetchWithTimeout(url);
        if (!res.ok) {
          // Don't retry here — back off so a busy client can't keep re-tripping the
          // rate limit. Serve stale/transparent meanwhile; recover after the cooldown.
          this.startCooldown(res);
          const waitS = Math.round((this.cooldownUntil - Date.now()) / 1000);
          this.logger.warn(`Open-Meteo grid chunk → ${res.status}; backing off ${waitS}s`);
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
      // Timeout / network error — back off too, so we don't hot-loop on a flaky upstream.
      this.startCooldown();
      this.logger.warn(`Open-Meteo grid failed: ${(error as Error).message}; backing off ${this.failCooldownMs / 1000}s`);
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
