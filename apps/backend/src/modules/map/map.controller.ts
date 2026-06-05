import { Controller, Get, Header, Query } from "@nestjs/common";

/**
 * Public (no-auth) map helpers. MapLibre Native's offline downloader needs the
 * style as a fetchable URL (inline JSON and file:// are both rejected), so we
 * serve a minimal raster style here that wraps whatever tile template the app
 * is using.
 */
@Controller("map")
export class MapController {
  @Get("offline-style")
  @Header("Content-Type", "application/json")
  @Header("Cache-Control", "no-cache")
  offlineStyle(@Query("tiles") tiles?: string, @Query("tileSize") tileSize?: string) {
    const tilesUrl = tiles && tiles.trim().length > 0
      ? tiles
      : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
    const size = Number(tileSize) || 256;
    return {
      version: 8,
      sources: {
        "offline-base": { type: "raster", tiles: [tilesUrl], tileSize: size },
      },
      layers: [{ id: "offline-base", type: "raster", source: "offline-base" }],
    };
  }
}
