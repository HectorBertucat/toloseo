import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    solidPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: false,
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/sw\.js$/],
        // Cap precache to app shell only — tiles / GTFS go through runtime
        // caching so we don't blow the iOS storage quota.
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          // Google Fonts CSS: StaleWhileRevalidate.
          {
            urlPattern: ({ url }) => url.hostname === "fonts.googleapis.com",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "gfonts-css-v1",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          // Google Fonts woff2 files: CacheFirst (immutable).
          {
            urlPattern: ({ url }) => url.hostname === "fonts.gstatic.com",
            handler: "CacheFirst",
            options: {
              cacheName: "gfonts-woff2-v1",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // OpenFreeMap tiles: immutable per style version → CacheFirst with
          // expiration + quota guard.
          {
            urlPattern: ({ url }) =>
              url.hostname === "tiles.openfreemap.org",
            handler: "CacheFirst",
            options: {
              cacheName: "ofm-tiles-v1",
              expiration: {
                maxEntries: 2000,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Map style JSON / sprites / glyphs: rare, cache for a day.
          {
            urlPattern: ({ url }) =>
              url.hostname === "tiles.openfreemap.org" &&
              (url.pathname.endsWith(".json") ||
                url.pathname.includes("/sprites/") ||
                url.pathname.includes("/glyphs/")),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "ofm-meta-v1",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
          // GTFS static (lines, stops, shapes) — changes ~weekly.
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/api/lines") ||
              url.pathname.startsWith("/api/stops"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "gtfs-static-v1",
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
          // GTFS-RT: never serve stale as fresh. NetworkFirst with 3s fallback
          // lets the UI degrade to cached state offline.
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/api/vehicles") ||
              url.pathname.startsWith("/api/alerts") ||
              url.pathname.includes("/departures"),
            handler: "NetworkFirst",
            options: {
              cacheName: "gtfs-rt-v1",
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../../shared"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
    // Surface regressions early: warn at 300 kB instead of 500 kB.
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      output: {
        // Split heavy / shared deps into their own chunks so:
        //   - MapLibre (~230 kB gzipped) caches independently of the app.
        //     A SolidJS-only update doesn't bust the user's tile-renderer.
        //   - solid-js + @solidjs/router land in a tiny shared chunk so
        //     route-lazy views (Analytics, Favorites, DepartureBoard)
        //     don't each re-bundle the framework.
        //   - lucide-solid icons import-by-name produces one shared chunk.
        manualChunks: (id) => {
          if (id.includes("node_modules/maplibre-gl")) return "maplibre";
          if (
            id.includes("node_modules/solid-js") ||
            id.includes("node_modules/@solidjs")
          ) {
            return "solid";
          }
          if (id.includes("node_modules/lucide-solid")) return "icons";
          if (id.includes("node_modules/")) return "vendor";
          return undefined;
        },
      },
    },
  },
});
