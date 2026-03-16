self.addEventListener('install', (event) => {
  event.waitUntil(caches.open('skye-pdf-forge-v1').then((cache) => cache.addAll([
    './',
    './index.html',
    './app.css',
    './app.js',
    './manifest.webmanifest',
    './assets/logo-optimized.png'
  ])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
