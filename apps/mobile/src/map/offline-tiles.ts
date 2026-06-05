import { OfflineManager, type OfflinePack } from "@maplibre/maplibre-react-native";
import { resolveLocalhostUrl } from "../ui/runtime-host";
import { debugLog } from "../debug/debug-log";

/** Identifies our single event-area pack across reinstalls of the same build. */
const PACK_KEY = "event-area-v1";

const API_BASE_URL = resolveLocalhostUrl(
  process.env.EXPO_PUBLIC_API_URL ?? "https://events-api.hackohackob.com/api",
);

export interface OfflineProgress {
  percentage: number;
  state: "inactive" | "active" | "complete";
  completedTileCount: number;
}

// ─── Size estimation ─────────────────────────────────────────────────────────

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}
function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z));
}

/** Number of raster tiles needed to cover [west,south,east,north] over a zoom range. */
export function tileCountForBounds(
  bounds: [number, number, number, number],
  minZoom: number,
  maxZoom: number,
): number {
  const [west, south, east, north] = bounds;
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const xMin = lonToTileX(west, z);
    const xMax = lonToTileX(east, z);
    const yMin = latToTileY(north, z); // north → smaller y
    const yMax = latToTileY(south, z);
    total += (Math.abs(xMax - xMin) + 1) * (Math.abs(yMax - yMin) + 1);
  }
  return total;
}

/** Rough download size in MB (~18 KB per 256px raster tile, ×scale for @2x). */
export function estimateMb(tiles: number, tileSize: number): number {
  const perTileKb = tileSize >= 512 ? 45 : 18;
  return (tiles * perTileKb) / 1024;
}

/** Approximate ground span of the bounds, in km. */
export function boundsSpanKm(bounds: [number, number, number, number]): { widthKm: number; heightKm: number } {
  const [west, south, east, north] = bounds;
  const midLat = (south + north) / 2;
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((midLat * Math.PI) / 180);
  return {
    widthKm: Math.abs(east - west) * kmPerDegLng,
    heightKm: Math.abs(north - south) * kmPerDegLat,
  };
}

/**
 * MapLibre Native's offline downloader requires `mapStyle` to be a *fetchable URL*
 * — inline JSON and file:// are both rejected ("Unable to parse resourceUrl"). So
 * the backend serves a minimal raster style at /map/offline-style, wrapping the
 * same tile template the live map uses; we just point the downloader at it.
 */
function rasterStyleUrl(tilesUrl: string, tileSize: number): string {
  const params = `tiles=${encodeURIComponent(tilesUrl)}&tileSize=${tileSize}`;
  return `${API_BASE_URL}/map/offline-style?${params}`;
}

export async function getEventPack(): Promise<OfflinePack | null> {
  try {
    const packs = await OfflineManager.getPacks();
    return packs.find((p) => (p.metadata as { packKey?: string })?.packKey === PACK_KEY) ?? null;
  } catch (err) {
    debugLog("app", "warn", "getPacks failed", String(err));
    return null;
  }
}

export async function getEventPackStatus(): Promise<OfflineProgress | null> {
  const pack = await getEventPack();
  if (!pack) return null;
  try {
    const status = await pack.status();
    return {
      percentage: status.percentage,
      state: status.state,
      completedTileCount: status.completedTileCount,
    };
  } catch {
    return null;
  }
}

export async function deleteEventPack(): Promise<void> {
  const pack = await getEventPack();
  if (!pack) return;
  try {
    await OfflineManager.deletePack(pack.id);
  } catch (err) {
    debugLog("app", "warn", "deletePack failed", String(err));
  }
}

/**
 * Download (or re-download) the offline pack for the given map bounds. Replaces
 * any existing event pack so the user always has the latest region cached.
 */
export async function downloadEventPack(opts: {
  tilesUrl: string;
  tileSize: number;
  bounds: [number, number, number, number]; // [west, south, east, north]
  minZoom?: number;
  maxZoom?: number;
  onProgress?: (progress: OfflineProgress) => void;
  onError?: (message: string) => void;
}): Promise<void> {
  await deleteEventPack();

  const styleUrl = rasterStyleUrl(opts.tilesUrl, opts.tileSize);

  await OfflineManager.createPack(
    {
      mapStyle: styleUrl,
      bounds: opts.bounds,
      minZoom: opts.minZoom ?? 10,
      maxZoom: opts.maxZoom ?? 16,
      metadata: { packKey: PACK_KEY, name: "Event area" },
    },
    (_pack, status) =>
      opts.onProgress?.({
        percentage: status.percentage,
        state: status.state,
        completedTileCount: status.completedTileCount,
      }),
    (_pack, error) => {
      debugLog("app", "error", "offline pack error", error.message);
      opts.onError?.(error.message);
    },
  );
}
