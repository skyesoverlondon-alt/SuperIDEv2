
const CACHE = 'skyecloud-cache-v1';
const PRECACHE = [
  './',
  './index.html',
  './assets/styles.css',
  './assets/app-core.js',
  './assets/page-home.js',
  './assets/skyecloud-logo.png',
  './apps/cloudcode/index.html',
  './apps/doclab/index.html',
  './apps/dataforge/index.html',
  './apps/flowboard/index.html',
  './apps/snippetvault/index.html',
  './apps/promptstudio/index.html',
  './apps/assetvault/index.html',
  './apps/brandboard/index.html',
  './apps/deploydesk/index.html',
  './apps/kaixu/index.html'
];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/.netlify/functions/')) {
    event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({ ok:false, offline:true }), { headers:{ 'Content-Type':'application/json' } })));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(found => found || fetch(event.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, clone));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
