/* SOLE Sales App PWA Service Worker — v5.0.0 */
const CACHE = "sole-sales-v5.0.0";
const ASSETS = [
  "./",
  "./index.html",
  "./portal.html",
  "./styles.css",
  "./app.js",
  "./portal.js",
  "./manifest.json",
  "./assets/logo.png",
  "./assets/logo.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/noise.png"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil((async()=>{
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE ? caches.delete(k) : Promise.resolve()));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // App shell: navigation requests -> network-first, cache fallback
  if (req.mode === "navigate") {
    e.respondWith((async()=>{
      try {
        const fresh = await fetch(req);
        return fresh;
      } catch(err) {
        const cachedRoute = await caches.match(req);
        const cachedIndex = await caches.match("./index.html");
        return cachedRoute || cachedIndex || new Response("Offline", {status: 200, headers: {"Content-Type":"text/plain"}});
      }
    })());
    return;
  }

  // Same-origin assets: cache-first
  if (url.origin === location.origin) {
    e.respondWith((async()=>{
      const cached = await caches.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      const c = await caches.open(CACHE);
      c.put(req, fresh.clone());
      return fresh;
    })());
    return;
  }

  // Third-party (Firebase CDN): network-first with runtime cache fallback
  e.respondWith((async()=>{
    try {
      const fresh = await fetch(req);
      const c = await caches.open(CACHE);
      c.put(req, fresh.clone());
      return fresh;
    } catch(err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw err;
    }
  })());
});
