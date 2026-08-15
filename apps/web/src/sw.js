// fouine service worker — offline access to the dashboard shell and past reviews.
// Runtime caching only: no build-time precache manifest, so it works identically
// whether Bun serves public/ (dev) or Vite serves dist/ (prod) with hashed names.
// ponytail: hand-rolled instead of vite-plugin-pwa — a few lines beat a new dep +
// Workbox, and runtime caching needs no knowledge of hashed filenames.

const CACHE = "fouine-v1";

// Take over open clients as soon as a new SW activates, and drop old caches.
// Precache the app shell so the dashboard opens offline from the first visit.
// Elysia serves index.html at "/" (indexHTML: true), so that's the cache key.
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add("/")));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, refreshing the cached shell, falling back to it
  // offline. SPA routes all resolve to the same shell, so cache it under "/".
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put("/", res.clone()));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // API + assets: stale-while-revalidate so past reviews stay readable offline.
  e.respondWith(staleWhileRevalidate(request));
});
