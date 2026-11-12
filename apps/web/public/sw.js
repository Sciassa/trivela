/* Offline support: network first (so a new version is picked up at once), cache as fallback. Fonts are cache first. */
const CACHE = "trivela-v2";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html", "./manifest.webmanifest", "./icon.svg"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || !url.protocol.startsWith("http")) return;
  const fonts = url.hostname.endsWith("gstatic.com") || url.hostname.endsWith("googleapis.com");
  if (url.origin !== location.origin && !fonts) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      if (fonts && hit) return hit;
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch (err) {
        if (hit) return hit;
        throw err;
      }
    }),
  );
});
