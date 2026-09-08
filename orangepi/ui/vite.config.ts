import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The console is served by the box itself, off an SD card, to a phone on a
 * hotspot with no internet. So: one bundle, no code splitting, no CDN fonts,
 * everything inlined that can be. `assetsInlineLimit` is raised for the same
 * reason — a second request for a 3 KB icon sprite is a request that can hang.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../public",
    emptyOutDir: true,
    assetsInlineLimit: 8192,
    rollupOptions: { output: { manualChunks: undefined } },
  },
  server: {
    port: 5180,
    // `npm run dev:ui` against a box on the bench, or the fake-hardware daemon.
    proxy: { "/api": process.env.GATEWAY_DEV_TARGET || "http://localhost:8080" },
  },
});
