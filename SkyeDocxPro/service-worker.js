/* Skye DocX — Offline PWA Service Worker
   Strategy:
   - Precache app shell (same-origin)
   - Precache critical external deps (CDNs) with no-cors so they are available offline after first load
   - Cache-first for static assets; network-first for navigations with offline fallback
*/
const VERSION = "skye-docx-pwa-v3";
const SHELL_CACHE = "shell-" + VERSION;
const RUNTIME_CACHE = "runtime-" + VERSION;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./homepage.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/favicon-16.png",
  "./assets/icons/favicon-32.png",
  "./assets/icons/icon-128.png",
  "./assets/icons/icon-144.png",
  "./assets/icons/icon-152.png",
  "./assets/icons/icon-192-maskable.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-384.png",
  "./assets/icons/icon-512-maskable.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-72.png",
  "./assets/icons/icon-96.png"
];
const EXTERNAL_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/quill/1.3.7/quill.snow.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/quill/1.3.7/quill.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js",
  "https://unpkg.com/lucide@latest",
  "https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&family=Inter:wght@400;500;600&family=Merriweather:wght@400;700&display=swap",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Merriweather:wght@400;700&display=swap"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(PRECACHE_URLS);

    // Best-effort precache for CDN deps (opaque responses are fine)
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled(EXTERNAL_ASSETS.map(async (url) => {
      try {
        const req = new Request(url, { mode: "no-cors" });
        const res = await fetch(req);
        // res may be opaque; still cacheable
        await runtime.put(url, res);
      } catch (e) {}
    }));

    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== SHELL_CACHE && k !== RUNTIME_CACHE) return caches.delete(k);
    }));
    self.clients.claim();
  })());
});

function isHTML(request) {
  return request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Navigations: network-first (for updates), fallback to cached shell, then offline page
  if (isHTML(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put("./index.html", fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match("./index.html");
        return cached || caches.match("./offline.html");
      }
    })());
    return;
  }

  // Static: cache-first, then network & cache (works for both same-origin and cross-origin)
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);
      const cache = await caches.open(RUNTIME_CACHE);
      // cache ok + opaque
      if (res && (res.status === 200 || res.type === "opaque")) {
        cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      // If a request fails completely, try to serve a cached copy of the URL string (for opaque precache)
      const fallback = await caches.match(req.url);
      if (fallback) return fallback;
      return new Response("", { status: 504, statusText: "Offline" });
    }
  })());
});
