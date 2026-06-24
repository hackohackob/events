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
        name: "Paramedic Event — Runner",
        short_name: "PE Runner",
        description: "Live course map + 2-tap emergency reporting for race participants.",
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
            // Weather radar tiles (RainViewer) — short cache so scrubbing across
            // frames is instant without holding stale frames forever.
            urlPattern: ({ url }) => /rainviewer\.com/.test(url.host),
            handler: "CacheFirst",
            options: {
              cacheName: "weather-radar",
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 2 },
            },
          },
          {
            // Weather forecast + radar index JSON (Open-Meteo / RainViewer).
            urlPattern: ({ url }) => /open-meteo\.com|api\.rainviewer\.com/.test(url.host),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "weather-api",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            // Read-only race data (tracks geojson, medics, pois).
            urlPattern: ({ url, request }) =>
              request.method === "GET" && /\/api\//.test(url.pathname),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "race-api",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
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
