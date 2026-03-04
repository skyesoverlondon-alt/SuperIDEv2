Skye DocX — Offline Installable PWA

Deploy:
- Drop this folder into Netlify (Publish directory: root)
- Visit the site once online, then use the browser install prompt:
  - Chrome/Edge (desktop): Install icon in address bar
  - Android: Add to Home screen / Install app
  - iOS Safari: Share → Add to Home Screen

Offline:
- After the first successful load, the service worker caches the full app shell + external CDN dependencies,
  so the app launches from the home-screen icon fully offline.

Notes:
- This build keeps the original UI/logic 1:1; only adds PWA plumbing + local brand images/icons.
