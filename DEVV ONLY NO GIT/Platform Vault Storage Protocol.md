# Platform Vault Storage Protocol

Date: 2026-03-13

## Rule
Every standalone app that persists operator data must use the shared storage protocol instead of ad hoc local-only save logic.

## Required Rails
1. Local-first state still lives inside the app surface.
2. Workspace sync must route through the app-record API so the latest state is backed by Neon per workspace.
3. Vault export must stage a `superide-vault-bridge-v1` envelope through `public/_shared/app-storage-protocol.js`.
4. Vault import must be accepted back into the app through the `kx.app.bridge` `vault-pro-import` event.
5. Each app must expose visible sync and vault status so smoke coverage can prove the lane is wired.

## Shared Embed
Use `public/_shared/app-storage-protocol.js`.

Minimum contract:
1. `appId`
2. `recordApp`
3. `wsId`
4. `statusElementId`
5. `vaultStatusElementId`
6. `getState`
7. `applyState`
8. `buildVaultPayload`

Optional controls:
1. `pushVaultButtonId`
2. `openVaultButtonId`
3. `targetAliases`

## Expected UX
1. `Sync ready` or equivalent app-record state visible in the surface.
2. `Vault ready` or equivalent vault bridge state visible in the surface.
3. A `Push to Vault` action available in the app.
4. A direct `Open Vault` action available in the app.

## First Reference Implementation
The contractor verification suite is the current reference lane:
1. App: `ContractorVerificationSuite`
2. Surface: `public/contractor income verification drop in/APP SURFACE/public/`
3. Backend allowlist: `netlify/functions/_shared/app-records.ts`
4. Smoke proof: `scripts/smoke-contractor-verification-playwright.mjs`

## Rollout Standard
When onboarding another app:
1. Add the app to the app-record allowlist if it needs workspace sync.
2. Replace raw `SkyeWorkspaceRecordSync` usage with `SkyeAppStorageProtocol.create(...)`.
3. Add vault status and push/open controls to the surface.
4. Ensure Vault Pro can export back into the app target where relevant.
5. Add or extend smoke coverage so sync + vault controls are proven, not assumed.