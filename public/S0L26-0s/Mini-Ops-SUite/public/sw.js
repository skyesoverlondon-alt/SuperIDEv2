/* Skye Mini Ops Suite - service worker */
const CACHE_NAME = "skye-mini-ops-20260222-100700-PHX";
const OFFLINE_URL = "/offline.html";

// Precache the app shell for offline usage.
const PRECACHE_URLS = [
  "/assets/app.css",
  "/assets/build.json",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/maskable-192.png",
  "/assets/icons/maskable-512.png",
  "/assets/logo.png",
  "/assets/logo.svg",
  "/assets/pwa.js",
  "/assets/shell.js",
  "/assets/suite.js",
  "/index.html",
  "/manifest.webmanifest",
  "/offline.html",

  "/sync/index.html",
  "/sync/app.js",

  "/sso/oidc-callback.html",
  "/sso/oidc-callback.js",
  "/sso/saml-acs.js",

  "/skyecash/app.js",
  "/skyecash/index.html",
  "/skyefocus/app.js",
  "/skyefocus/index.html",
  "/skyenote/app.js",
  "/skyenote/index.html"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS);
    await cache.add(OFFLINE_URL);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k.startsWith("skye-mini-ops-") && k !== CACHE_NAME) ? caches.delete(k) : Promise.resolve()));
    self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if(event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if(req.method !== "GET") return;

  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  // Never cache function responses.
  if(url.pathname.startsWith('/.netlify/functions/')) return;

  // Update channel must be network-fresh. Never cache /updates/*.
  if(url.pathname.startsWith('/updates/')) {
    event.respondWith((async () => {
      const req2 = new Request(req, { cache: 'no-store' });
      return fetch(req2);
    })());
    return;
  }

  // Respect explicit no-store requests (used by signed-update asset verification).
  if(req.cache === 'no-store' || String(req.headers.get('cache-control')||'').includes('no-cache')){
    event.respondWith(fetch(req));
    return;
  }

  // Navigation: network-first (for updates), fallback to cache/offline
  if(req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || await caches.match(OFFLINE_URL);
      }
    })());
    return;
  }

  // Static assets: cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if(cached) return cached;
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      return cached || Response.error();
    }
  })());
});
