# Backup Brain Migration Standard

This document defines the standard way this repo should handle kAIxU "brain" routing, failover, and future migration away from direct provider calls.

## Purpose

The product requirement is simple:

- A signed-in user with valid kAIxU access should not lose AI capability just because one route is down.
- Public app surfaces must not leak shared provider secrets.
- The platform must be able to migrate apps from direct provider mode to a server-side backup brain without rewriting every app contract from scratch.

## Current State

As of 2026-03-07, this repo now has a server-side backup-brain route for the secured Netlify AI path.

Current AI execution modes are split:

- Direct provider in browser:
  - `public/kAIxu-Persona/index.html`
  - `public/kAIxU-Matrix/index.html`
- Gateway-backed through Netlify function `/api/kaixu-generate`:
  - `public/kAixu-Nexus/index.html`
  - `public/kAIxU-Vision/index.html`
  - `public/kAIxU-Codex/index.html`
  - `public/kAIxu-Atmos/index.html`
  - `public/kAIxu-Quest/index.html`
  - `public/kAIxu-Forge/index.html`
  - `public/kAIxu-Atlas/index.html`
  - `public/kAixU-Chronos/index.html`
  - `public/kAIxu-Bestiary/index.html`
  - `public/kAIxu-Mythos/index.html`
  - `public/kAIxU-Faction/index.html`
  - `public/kAIxU-PrimeCommand/index.html`

The gateway path is real in this repo. The function at `netlify/functions/kaixu-generate.ts` forwards requests using server-side `KAIXU_GATEWAY_ENDPOINT` and `KAIXU_APP_TOKEN`.

The backup path is now real too:

- Netlify AI routes can fail over through the Worker route `/v1/brain/backup/generate`
- the Worker route is runner-signed and stays server-side
- the Worker backup route requires its own upstream endpoint via `KAIXU_BACKUP_ENDPOINT`
- the Worker may reuse the same `KAIXU_APP_TOKEN` secret the IDE already uses, or use `KAIXU_BACKUP_TOKEN` if needed

## Non-Negotiable Security Rule

Do not inject a shared provider master key into public static apps.

That means:

- no `VITE_OPENAI_API_KEY`
- no `VITE_GEMINI_API_KEY`
- no build-time provider secrets in `public/kAI*/index.html`
- no "same env key for every public app" approach

Any key shipped to the browser is exposed.

If a public app needs direct-provider mode, it must use a user-supplied personal key that belongs to that user, not a platform master secret.

## Standard Brain Model

Every AI-capable app should conceptually support three brain routes.

### Route 1: Primary Brain

The preferred path.

- Usually `/api/kaixu-generate`
- Uses server-side gateway credentials
- Applies auth, audit, and SKNore checks

### Route 2: Backup Brain

The failover path when the primary brain is unavailable but the user is otherwise valid.

- Must be server-side
- Must keep provider secrets off the client
- Lives in Worker runtime in the current implementation
- Must expose the same normalized request and response contract as the primary brain

### Route 3: User Direct Brain

This is not the default platform path. It is a user-owned escape hatch.

- Uses a user-entered provider key in-browser
- Only allowed for apps intentionally operating in direct-provider mode
- Must be clearly labeled as direct-provider mode
- Must never silently replace the secured platform route without user awareness

## Standard Request Contract

All brain routes should accept the same logical payload shape:

```json
{
  "ws_id": "primary-workspace",
  "activePath": "/public/kAixu-Nexus/index.html",
  "prompt": "User request here",
  "files": [],
  "model": "optional-model-override",
  "brain_policy": {
    "allow_backup": true,
    "allow_user_direct": false
  }
}
```

## Standard Response Contract

All brain routes should return the same normalized shape:

```json
{
  "ok": true,
  "text": "Generated output",
  "brain": {
    "route": "primary|backup|user-direct",
    "provider": "label-only",
    "model": "effective-model",
    "request_id": "optional-request-id"
  }
}
```

Error shape should be normalized too:

```json
{
  "ok": false,
  "error": "Human readable message",
  "brain": {
    "route": "primary|backup|user-direct",
    "failed": true
  }
}
```

## Failover Rules

Backup brain should trigger only when all of these are true:

- user auth is valid
- workspace access is valid
- primary brain request failed due to runtime or upstream dependency failure
- failure is not caused by a policy block, auth block, or SKNore block

Backup brain should **not** trigger for:

- invalid login
- missing token email lock match
- missing workspace permissions
- SKNore refusal
- malformed request body

Those must fail loudly.

## Trigger Matrix

### Fail loud, no fallback

- `401` auth/session failure
- `403` policy or SKNore refusal
- `400` malformed request

### Fail over to backup brain

- gateway timeout
- provider upstream `5xx`
- worker or Netlify dependency outage
- gateway endpoint unreachable

### Optional direct-user fallback

Only if the app explicitly supports user direct-provider mode and the user has supplied a personal provider key.

## UI Truth Standard

Every AI-capable surface should expose truth state with at least these signals:

- `Session`
- `Key`
- `Brain`
- `Last Action`

Suggested states:

- `ok`: active and healthy
- `warn`: available with caution or degraded mode
- `fail`: unavailable or blocked

Examples:

- `Brain: Primary`
- `Brain: Backup`
- `Brain: User Direct`
- `Brain: Offline`

The user should be able to tell which brain actually answered the request.

## Migration Standard

When converting an app from direct-provider mode to backup-brain-first mode, use this sequence.

1. Keep the app request payload shape stable.
2. Move provider secret usage out of the browser.
3. Point the app at a normalized server route.
4. Return a normalized `brain.route` field.
5. Add truth-light UI for route visibility.
6. Add fallback only for runtime outages, not for auth/policy failures.

## Direct-Provider Legacy App Standard

If a kAIxU app stays direct-provider for now, it must follow these rules:

- show explicit provider mode in UI
- only use a user-owned key
- never imply secured gateway protection if it is not actually being used
- keep the provider access code isolated so it can be replaced by backup-brain routing later

## Recommended Implementation Target

The cleanest repo-wide design is:

- Primary brain: `netlify/functions/kaixu-generate.ts`
- Backup brain: Worker-backed generation route at `/v1/brain/backup/generate` with the same normalized contract
- User direct brain: app-local direct provider mode for explicitly legacy surfaces only

That gives the platform a stable contract while keeping secrets server-side.

## Practical Repo Rule

Before changing any kAIxU app:

- decide whether it is `direct-provider legacy` or `secured brain route`
- do not mix fake gateway labels with real direct calls
- do not ship shared provider secrets to public HTML
- keep fallback behavior explicit and auditable

## Immediate Follow-Up Work

The next implementation pass should do this:

1. Add brain truth lights to all kAIxU legacy apps.
2. Decide which apps remain intentionally direct-provider and which ones move fully behind secured server routing.
3. Point additional secured AI endpoints at the same shared failover helper.
4. Add smoke coverage for primary-failure-to-backup success cases.