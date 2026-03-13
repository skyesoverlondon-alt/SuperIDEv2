const CACHE_NAME = "kaixu-superide-shell-v2";
const CACHE_NAME = "kaixu-superide-shell-v3";
const APP_SHELL = [
  "/",
  "/index.html",
  "/recover-account/",
  "/recover-account/index.html",
  "/manifest.webmanifest",
  "/SKYESOVERLONDONDIETYLOGO.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/.netlify/functions/")) return;

  if (request.mode === "navigate") {
    const isRecoverRoute = url.pathname === "/recover-account" || url.pathname === "/recover-account/";
    event.respondWith(
      fetch(request)
        .then((response) => {
          const requestCopy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => {
            void cache.put(request, requestCopy);
            if (url.pathname === "/" || url.pathname === "/index.html") {
              void cache.put("/index.html", response.clone());
            }
            if (isRecoverRoute) {
              void cache.put("/recover-account/", response.clone());
            }
          });
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (
            (await cache.match(request)) ||
            (isRecoverRoute ? await cache.match("/recover-account/") : await cache.match("/index.html")) ||
            Response.error()
          );
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === "opaque") {
          return response;
        }
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});