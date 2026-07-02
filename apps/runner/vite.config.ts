import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { fileURLToPath } from "url";

// Lightweight runner PWA. Aliases @events/contracts to the source so the shared
// types compile without a separate build step.
// Set HTTPS=true to serve over self-signed TLS — required for the browser to
// grant real GPS (geolocation needs a secure context) when testing on a phone
// over the LAN (http://192.168.x.x is treated as insecure → coarse ±km fixes).
const useHttps = process.env.HTTPS === "true";

export default defineConfig({
  plugins: [
    react(),
    ...(useHttps ? [basicSsl()] : []),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "RaceSafe — Academy First Aid",
        short_name: "RaceSafe",
        description: "Live course map + 2-tap emergency reporting for race participants, by Academy First Aid.",
        theme_color: "#0A1118",
        background_color: "#0A1118",
        display: "standalone",
        orientation: "portrait",
        start_url: "/?source=pwa",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        navigateFallback: "index.html",
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        runtimeCaching: [
          {
            // OSM / Carto map tiles — cache the last viewed area + explicit
            // offline-map downloads (see src/lib/offline-map.ts). High maxEntries
            // so a downloaded event area isn't evicted by casual browsing.
            urlPattern: ({ url }) =>
              /tile\.openstreetmap\.org|basemaps\.cartocdn\.com|tiles?\./.test(url.host),
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 8000, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
            },
          },
          {
            // Open-Meteo weather overlays (rendered PNGs from our backend). Short
            // cache so panning/offline is instant but new forecasts arrive.
            urlPattern: ({ url }) => /\/api\/weather\/overlay\//.test(url.pathname),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "weather-radar",
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 20 },
            },
          },
          {
            // Weather forecast JSON (Open-Meteo).
            urlPattern: ({ url }) => /open-meteo\.com/.test(url.host),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "weather-api",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            // Read-only race data (tracks geojson, medics, pois). Excludes the
            // weather overlays (handled above) and /incidents (a runner's own
            // reports change by the second — polled every 8s for the "view
            // active alert" button — and must never be served stale/cached).
            urlPattern: ({ url, request }) =>
              request.method === "GET" &&
              /\/api\//.test(url.pathname) &&
              !/\/api\/weather\//.test(url.pathname) &&
              !/\/api\/incidents/.test(url.pathname),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "race-api",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              // Requests like /events/tracks and /events/pois scope by the
              // x-event-id HEADER, not the URL — Workbox's default cache key is
              // URL-only, so switching events could serve the previous event's
              // cached tracks/POIs. Fold the header into the cache key so each
              // event gets its own entry.
              plugins: [
                {
                  cacheKeyWillBeUsed: async ({ request }) => {
                    const eventId = request.headers.get("x-event-id");
                    if (!eventId) return request.url;
                    const url = new URL(request.url);
                    url.searchParams.set("_eid", eventId);
                    return url.toString();
                  },
                },
              ],
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@events/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    proxy: {
      // Proxy API + websocket to the backend during dev so the PWA is same-origin.
      "/api": { target: "http://localhost:8500", changeOrigin: true },
      "/uploads": { target: "http://localhost:8500", changeOrigin: true },
      "/realtime": { target: "http://localhost:8500", ws: true, changeOrigin: true },
    },
  },
});
