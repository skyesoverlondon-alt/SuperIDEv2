# SkyeSpace Platform Spectacle

Static multi-page platform UI with:
- 17 routed pages
- injected Three.js background lane (`js/background-injector.js`)
- shared platform data layer (`js/platform-data.js`)
- shared UI behavior layer (`js/platform.js`)
- premium CSS shell (`css/platform.css`)

Note: the background loader pulls Three.js from a CDN at runtime and falls back to a custom animated canvas field if the CDN is unavailable.
