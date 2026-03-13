# SkyeVault Pro · Hosted Family Upgrade

This version keeps the offline-first personal vault, but adds a lighter hosted layer for subscriptions and member recovery.

## What changed

- Page-wide drag and drop for files, folders, and zip archives
- Zip unpacking straight into the vault when JSZip is available
- Stronger SkyeDocx branding with your logo visible in the editor shell
- Hosted AI helper through a Netlify Function that prefers the kAIxU gateway and can fail over to a backup brain route
- Optional hosted vault backup through Netlify Blobs
- Hosted member profile sync through the shared SuperIDE database/runtime
- Optional session-aware hosted bridge for the shared SuperIDE runtime

## Deploy notes

1. Deploy the main SuperIDE repo to Netlify.
2. Set these environment variables in the main Netlify site:
   - `KAIXU_GATEWAY_ENDPOINT` for the primary routed brain
   - `KAIXU_APP_TOKEN` for the primary routed brain token
   - `KAIXU_BACKUP_ENDPOINT` optional, for backup brain failover
   - `KAIXU_BACKUP_TOKEN` optional, for an independent backup token
   - `KAIXU_GATEWAY_MODEL` optional, defaults to `kAIxU-Prime6.7`
   - `KAIXU_BACKUP_MODEL` optional, defaults to the primary model
3. The live runtime endpoints are the root Netlify Functions in the main app, not the old sidecar `public/.../netlify/functions` folder.
4. Hosted backup and hosted profile sync wake up when the main site is deployed with Functions and session auth.

## Important reality notes

- Local vault storage still lives in IndexedDB first.
- Hosted backup is optional and account-bound.
- Hosted profile sync now uses the main SuperIDE session and shared database path instead of a separate sidecar profile store.
- This surface can now ride the main SuperIDE session directly, so a separate Netlify Identity mini-stack is no longer the preferred path.
- The app still works without hosted auth: offline storage, thumb-drive sync, and local editing remain available.

## Subscription angle

The membership profile form now stores a plan tier so you can map:

- Core → 256GB annual thumb drive
- Flow → 512GB annual thumb drive
- Pro → 1TB annual thumb drive

That is metadata and workflow support, not shipping automation. The app remembers the tier and hosted profile state, but it does not buy postage by sorcery.


## Founder page

A founder editorial page is available at `/founder/index.html` and linked from the home, vault, and SkyeDocx surfaces.
