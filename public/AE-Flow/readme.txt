AE FLOW by Skyes Over London — Netlify Drop Folder

Deploy:
1) Drag-and-drop the folder into Netlify manual deploy, or zip and upload.
2) Ensure publish directory is the folder root (the same folder containing index.html).

PWA:
- After deploy, open the site on mobile → Share → "Add to Home Screen" (iOS) or Install prompt (Android/Chrome).
- Works offline after first load.

Files:
- index.html
- sw.js
- manifest.webmanifest
- icons (.png)
- _headers (prevents stale SW/manifest caching)

3D Cosmos Background:
- Uses Three.js for a vibrant animated cosmos behind the UI.
- Three.js is cached by the service worker after first online load.
- If you load the app while fully offline before caching, the app falls back to the original gradient background.
