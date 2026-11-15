import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Installable app (SPEC §12.7): added to the home screen, TRIVELA opens full screen, without the browser's bars.
 * The service worker precaches the app shell; question packs are fetched on demand and cached as they are used,
 * so the lazy loading of SPEC §0.4 is unchanged (phones never download them).
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false, // registered in main.tsx
      manifest: {
        id: "./",
        name: "TRIVELA — il quiz per maniaci del calcio",
        short_name: "TRIVELA",
        description: "Quiz calcistico arcade 1 contro 1, su uno schermo o con i telefoni.",
        lang: "it",
        start_url: "./",
        scope: "./",
        display: "fullscreen",
        display_override: ["fullscreen", "standalone"],
        // the Screen is played sideways, the Regia and the controllers upright: the app follows the phone
        orientation: "any",
        background_color: "#0b0b1a",
        theme_color: "#0b0b1a",
        categories: ["games", "sports", "entertainment"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        globIgnores: ["data/**"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // packs change with every data update: the network first, the cache when offline
            urlPattern: ({ url }) => url.pathname.includes("/data/"),
            handler: "NetworkFirst",
            options: { cacheName: "trivela-data", networkTimeoutSeconds: 5, expiration: { maxEntries: 20 } },
          },
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: { cacheName: "trivela-fonts", expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  base: "./",
});
