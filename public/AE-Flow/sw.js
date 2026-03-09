/* AE FLOW by Skyes Over London — Service Worker (offline-first) */
const CACHE_NAME = "ae-flow-cache-v2";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./maskable-512.png",
  "./apple-touch-icon.png"
];

const THIRD_PARTY_URLS = [
  "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js",
  "https://unpkg.com/three@0.160.0/build/three.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS);
    // Pre-cache Three.js (opaque responses are OK). If offline during install, it will fall back gracefully.
    await Promise.all(THIRD_PARTY_URLS.map(async (u) => {
      try {
        await cache.add(new Request(u, { mode: "no-cors" }));
      } catch (e) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME) ? caches.delete(k) : Promise.resolve()));
    self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(request, { ignoreSearch: true });
    return cached || cache.match("./index.html");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}


async function cacheFirstAny(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try{
    const fresh = await fetch(request);
    if (fresh) cache.put(request, fresh.clone());
    return fresh;
  }catch(e){
    return cached || Response.error();
  }
}


self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Handle SPA-style navigations: keep app launching offline.
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }

  const url = new URL(req.url);
  if (req.method !== "GET") return;

  const isSameOrigin = (url.origin === self.location.origin);
  const isThirdPartyAllowed = THIRD_PARTY_URLS.includes(url.href);

  // Cache allowed third-party assets (e.g., Three.js) so the cosmos works after first load.
  if (!isSameOrigin && isThirdPartyAllowed) {
    event.respondWith(cacheFirstAny(req));
    return;
  }

  // Ignore other cross-origin requests.
  if (!isSameOrigin) return;

  // Cache-first for static assets.
  event.respondWith(cacheFirst(req));
});
