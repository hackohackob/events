/**
 * Offline map packs for the PWA. Mirrors the native app's "Download offline map"
 * flow (apps/mobile/src/map/offline-tiles.ts) but uses the browser Cache Storage
 * API instead of MapLibre Native's OfflineManager.
 *
 * How offline actually works here: the service worker (vite-plugin-pwa, see
 * vite.config.ts) serves raster tiles `CacheFirst` from a cache named
 * `map-tiles`. We pre-warm that exact cache by fetching every tile in the chosen
 * area/zoom and `cache.put`-ing it under the same URL MapLibre will request — so
 * when the runner loses signal the SW hands those tiles straight back.
 *
 * The Cache API is available in any secure context (https / localhost), so the
 * download works in dev too; only the *serving* needs the prod service worker.
 */

/** Tile source we cache for offline — the same street basemap RunnerMap renders. */
export const OSM_TILE_URL = "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Must match the `cacheName` of the tiles runtimeCaching route in vite.config.ts. */
const TILE_CACHE = "map-tiles";

const META_KEY = "pe_offline_pack_v1";

export interface OfflineQuality {
  key: string;
  label: string;
  sublabel: string;
  minZoom: number;
  maxZoom: number;
}

export const QUALITIES: OfflineQuality[] = [
  { key: "fast", label: "Fast", sublabel: "Overview · streets & area", minZoom: 9, maxZoom: 13 },
  { key: "balanced", label: "Balanced", sublabel: "Recommended · most detail", minZoom: 9, maxZoom: 15 },
  { key: "detailed", label: "Detailed", sublabel: "Full zoom · large & slow", minZoom: 12, maxZoom: 16 },
];

export type Bounds = [number, number, number, number]; // [west, south, east, north]

export interface PackMeta {
  bounds: Bounds;
  minZoom: number;
  maxZoom: number;
  tileCount: number;
  tilesUrl: string;
  savedAt: number;
}

// ─── Tile math ───────────────────────────────────────────────────────────────

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

/** Every {z,x,y} tile covering the bounds across the zoom range. */
function tilesForBounds(bounds: Bounds, minZoom: number, maxZoom: number): Array<[number, number, number]> {
  const [west, south, east, north] = bounds;
  const out: Array<[number, number, number]> = [];
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const xMin = lonToTileX(west, z);
    const xMax = lonToTileX(east, z);
    const yMin = latToTileY(north, z); // north → smaller y
    const yMax = latToTileY(south, z);
    for (let x = Math.min(xMin, xMax); x <= Math.max(xMin, xMax); x += 1) {
      for (let y = Math.min(yMin, yMax); y <= Math.max(yMin, yMax); y += 1) {
        out.push([z, x, y]);
      }
    }
  }
  return out;
}

export function tileCountForBounds(bounds: Bounds, minZoom: number, maxZoom: number): number {
  const [west, south, east, north] = bounds;
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const xMin = lonToTileX(west, z);
    const xMax = lonToTileX(east, z);
    const yMin = latToTileY(north, z);
    const yMax = latToTileY(south, z);
    total += (Math.abs(xMax - xMin) + 1) * (Math.abs(yMax - yMin) + 1);
  }
  return total;
}

/** Rough download size in MB (~18 KB per 256px raster tile). */
export function estimateMb(tiles: number): number {
  return (tiles * 18) / 1024;
}

export function boundsSpanKm(bounds: Bounds): { widthKm: number; heightKm: number } {
  const [west, south, east, north] = bounds;
  const midLat = (south + north) / 2;
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((midLat * Math.PI) / 180);
  return {
    widthKm: Math.abs(east - west) * kmPerDegLng,
    heightKm: Math.abs(north - south) * kmPerDegLat,
  };
}

export function fmtMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 100) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

/**
 * Bounding box around a set of points, padded by a fixed `bufferKm` on every
 * side. Used for the offline pack so the cached area hugs the *track* (plus a
 * small buffer) instead of stretching to wherever medics happen to be — that
 * kept the download small and centred on where the runner actually goes.
 */
export function boundsForPathKm(
  points: Array<{ lat: number; lng: number }>,
  bufferKm = 5,
): Bounds | null {
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (valid.length === 0) return null;
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const p of valid) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const midLat = (minLat + maxLat) / 2;
  const padLat = bufferKm / 111.32;
  const padLng = bufferKm / (111.32 * Math.cos((midLat * Math.PI) / 180));
  return [minLng - padLng, minLat - padLat, maxLng + padLng, maxLat + padLat];
}

/** Bounding box around a set of points, padded ~12% (min ~1 km) like the native app. */
export function boundsForPoints(points: Array<{ lat: number; lng: number }>): Bounds | null {
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (valid.length === 0) return null;
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const p of valid) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const padLat = Math.max((maxLat - minLat) * 0.12, 0.01);
  const padLng = Math.max((maxLng - minLng) * 0.12, 0.01);
  return [minLng - padLng, minLat - padLat, maxLng + padLng, maxLat + padLat];
}

// ─── Pack metadata (localStorage) ─────────────────────────────────────────────

export function getPackMeta(): PackMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as PackMeta) : null;
  } catch {
    return null;
  }
}

function savePackMeta(meta: PackMeta): void {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

// ─── Download / remove ────────────────────────────────────────────────────────

export interface DownloadProgress {
  done: number;
  total: number;
  failed: number;
}

/**
 * Fetch every tile for the area into the `map-tiles` Cache Storage bucket, with
 * limited concurrency so we're polite to the tile server and keep the UI alive.
 * Resolves once finished (or aborted via the signal).
 */
export async function downloadPack(opts: {
  bounds: Bounds;
  minZoom: number;
  maxZoom: number;
  tilesUrl?: string;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (p: DownloadProgress) => void;
}): Promise<PackMeta> {
  const template = opts.tilesUrl ?? OSM_TILE_URL;
  const tiles = tilesForBounds(opts.bounds, opts.minZoom, opts.maxZoom);
  const cache = await caches.open(TILE_CACHE);
  const total = tiles.length;
  let done = 0;
  let failed = 0;
  const concurrency = opts.concurrency ?? 6;

  let cursor = 0;
  const worker = async () => {
    while (cursor < tiles.length) {
      if (opts.signal?.aborted) return;
      const [z, x, y] = tiles[cursor++];
      const url = tileUrl(template, z, x, y);
      try {
        const existing = await cache.match(url);
        if (!existing) {
          const res = await fetch(url, { mode: "cors", signal: opts.signal });
          if (res.ok) await cache.put(url, res.clone());
          else failed += 1;
        }
      } catch {
        if (!opts.signal?.aborted) failed += 1;
      }
      done += 1;
      opts.onProgress?.({ done, total, failed });
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");

  const meta: PackMeta = {
    bounds: opts.bounds,
    minZoom: opts.minZoom,
    maxZoom: opts.maxZoom,
    tileCount: total - failed,
    tilesUrl: template,
    savedAt: Date.now(),
  };
  savePackMeta(meta);
  return meta;
}

/** Drop the saved pack's tiles from the cache and forget the metadata. */
export async function removePack(): Promise<void> {
  const meta = getPackMeta();
  localStorage.removeItem(META_KEY);
  if (!meta) return;
  try {
    const cache = await caches.open(TILE_CACHE);
    const tiles = tilesForBounds(meta.bounds, meta.minZoom, meta.maxZoom);
    await Promise.all(tiles.map(([z, x, y]) => cache.delete(tileUrl(meta.tilesUrl, z, x, y))));
  } catch {
    // best-effort
  }
}
