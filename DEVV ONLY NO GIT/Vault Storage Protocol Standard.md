# Vault Storage Protocol Standard

## Why This Exists
This is now standard protocol across SuperIDE.

Every real app surface must have:
1. Workspace-scoped persistence.
2. A path into the platform record rail so app state can persist through the shared runtime.
3. A direct push-to-vault path so app state can be staged into SkyeVault Pro for backup, archive, transfer, and cross-app handoff.
4. A reverse path from SkyeVault Pro back into apps through the existing bridge/import lane.

Local-first storage is still allowed as the fast cache layer.
Local-only storage is not the final platform posture for serious apps.

## Canonical Storage Shape
Each standalone surface should route through both of these platform rails:

1. App Record Sync
- Transport: `/api/app-record-save` and `/api/app-record-list`
- Backing: workspace-scoped `app_records` in Neon
- Purpose: authoritative workspace state for the app

2. Vault Snapshot Staging
- Transport: `kx.vaultpro.pending.import`
- Target: `SkyeVault-Pro-v4.46`
- Purpose: durable import into the platform vault, backup, archive, and cross-app relay

## Required Embed
Every standalone app that owns meaningful user or operator state should include:

```html
<script src="/_shared/auth-unlock.js"></script>
<script src="/_shared/standalone-session.js"></script>
<script src="/_shared/workspace-record-sync.js"></script>
<script src="/_shared/app-storage-protocol.js"></script>
```

## Required Runtime Metadata
Every app should expose:

```html
<body data-app-id="YourAppId">
```

Every app should also carry the active workspace through links and open-app routing using `ws_id`.

## Required JS Pattern
Use the shared protocol instead of ad hoc per-app storage glue when possible.

```js
const appStorage = window.SkyeAppStorageProtocol.create({
  appId: 'YourAppId',
  recordApp: 'YourAppId',
  wsId: getWorkspaceId(),
  statusElementId: 'syncStatus',
  vaultStatusElementId: 'vaultStatus',
  getState: buildWorkspaceSnapshot,
  applyState: applyWorkspaceSnapshot,
  getTitle: (model) => model.title || 'Your App Workspace',
});

await appStorage.load(false);
appStorage.debouncedSave();
await appStorage.stageToVault({ detail: 'YourAppId staged a vault snapshot.' });
appStorage.openVault({ note: 'YourAppId opened SkyeVault Pro.' });
```

## Platform Rules
1. New apps should not ship with local-only storage if they are meant to live in the formal platform.
2. Existing local-first apps should treat IndexedDB/localStorage as cache, not the only serious persistence lane.
3. Every serious app should expose `Push To Vault` and `Open Vault` actions or equivalent route affordances.
4. If an app stores structured workspace state, that app should be allowlisted in `netlify/functions/_shared/app-records.ts`.
5. If an app needs cross-app transfer, it should stage a `superide-vault-bridge-v1` payload for SkyeVault Pro.

## Current Adoption
The contractor verification suite is the first standalone surface explicitly moved onto this protocol.

That suite now has:
1. workspace-scoped IndexedDB
2. app-record sync compatibility
3. push-to-vault control
4. open-vault control
5. shared runtime carry behavior

## Next Upgrade Path
Use this protocol when touching other standalone surfaces.

Priority targets:
1. contractor-adjacent suites
2. kAIxU standalone apps
3. other local-first standalone surfaces that already keep meaningful user state