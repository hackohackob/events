import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "url";

// Lightweight runner PWA. Aliases @events/contracts to the source so the shared
// types compile without a separate build step.
export default defineConfig({
  plugins: [
    react(),
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
            // OSM / Carto map tiles — cache the last viewed area for offline.
            urlPattern: ({ url }) =>
              /tile\.openstreetmap\.org|basemaps\.cartocdn\.com|tiles?\./.test(url.host),
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 14 },
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
