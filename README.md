# kAIxU Super IDE · vNext (Fortune‑500 Wired)

This repository contains the complete source for **kAIxU Super IDE vNext**.  It is an end‑to‑end, enterprise‑grade web IDE with the following features:

* **Monaco Editor** – the same editing engine used in VS Code.  This provides syntax highlighting, multi‑file editing and language support without pulling in the entire VS Code workbench.
* **Org / Workspace Model** – users sign in, create or join an organisation, and can create multiple workspaces.  Each workspace has its own file graph and audit trail.
* **Audit & Evidence Packs** – every significant action (workspace save, export, Git push, deploy, AI call) is recorded in a Neon/PostgreSQL table.  Audit events can be exported as a signed evidence pack stored in Cloudflare R2 and downloaded via a signed URL.
* **GitHub App‑based Push** – rather than storing customer personal access tokens, the IDE uses a GitHub App.  Users install the app on their repository and provide the `installation_id` so that the server can mint installation access tokens on demand.  All pushes are executed server‑side via a Cloudflare Worker.
* **Netlify Deploy via API** – deploys are triggered on the server via Netlify’s Deploy API.  Tokens are vaulted in the Worker’s KV storage and never exposed to the client.
* **Kaixu Gateway Integration** – AI requests are proxied through your Kaixu Gateway using a server‑side token.  The client never holds provider secrets.

## Deployment Overview

This solution is split into two runtimes:

1. **Netlify Site** – Hosts the static frontend (Vite/React) and exposes a set of Netlify Functions which implement identity, policy enforcement, workspace APIs and auditing.  These functions never store provider secrets and always enforce tenancy (org/workspace) boundaries.  All heavy tasks are delegated to the Runner.

2. **Cloudflare Worker (Runner + Vault)** – Holds encrypted provider tokens in a KV namespace and executes privileged operations:
   * Performs Git commits & pushes using the GitHub Data API and a GitHub App installation token.
   * Triggers Netlify Deploy API uploads using vaulted tokens.
   * Creates signed evidence packs and stores them in an R2 bucket.
   * Serves those evidence packs via signed download URLs with expirations.

The two runtimes communicate via authenticated HTTP calls.  Each call is signed with an HMAC using `RUNNER_SHARED_SECRET` to prevent spoofing.  The Worker enforces a replay window and checks signatures on every request.

## Prerequisites

To deploy this solution you need:

* A **GitHub App** with the following settings:
  * Permissions: **Contents – Read & Write**, **Metadata – Read**.
  * A **private key** for signing JWTs, and the **App ID**.  These are provided to the Worker via environment variables.
  * The app’s **Setup URL** should point back to your Netlify site so users can easily install the app and obtain their `installation_id`.

* A **Neon/Postgres** database.  Run the `db/schema.sql` file on your database to create the required tables.

* A **Cloudflare account** with:
  * A **KV namespace** (named `kaixu-secrets` in this repo).  This stores encrypted provider tokens.
  * An **R2 bucket** (named `kaixu-evidence`).  Evidence packs are stored here.

* A **Netlify** site linked to this repository.  Environment variables are configured in the Netlify UI (see below).

## Configuration

Canonical env checklist: [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md)
Netlify example env file: [.env.netlify.example](.env.netlify.example)
Worker example env file: [worker/.dev.vars.example](worker/.dev.vars.example)

### Netlify environment variables

Set the following environment variables in your Netlify site settings:

| Variable | Description |
|---|---|
| `NEON_DATABASE_URL` | The Neon SQL‑over‑HTTP endpoint for your database. |
| `KAIXU_GATEWAY_ENDPOINT` | Your Kaixu Gateway endpoint, e.g. `https://your-gateway/v1/generate`. |
| `KAIXU_APP_TOKEN` | Server token used to call the Kaixu Gateway. |
| `WORKER_RUNNER_URL` | The URL of your deployed Cloudflare Worker (e.g. `https://kaixu-superide-runner.example.workers.dev`). |
| `RUNNER_SHARED_SECRET` | A shared secret used to sign and verify calls between Netlify and the Worker. |
| `CF_ACCESS_CLIENT_ID` | (optional, required when Worker domain is protected by Cloudflare Access service token policy) Access service token client ID. |
| `CF_ACCESS_CLIENT_SECRET` | (optional, required when Worker domain is protected by Cloudflare Access service token policy) Access service token secret. |
| `VITE_GITHUB_APP_INSTALL_URL` | (build time) The URL that users will visit to install your GitHub App.  Provided via the frontend build. |

### Cloudflare Worker secrets

After deploying the Worker with `wrangler deploy`, configure these secrets and variables via the Cloudflare dashboard or `wrangler secret put`:

| Secret | Description |
|---|---|
| `RUNNER_SHARED_SECRET` | The same secret used in Netlify. |
| `NEON_DATABASE_URL` | The same database URL used by Netlify. |
| `EVIDENCE_SIGNING_KEY` | A random HMAC key for signing evidence packs. |
| `GITHUB_APP_ID` | Your GitHub App’s numeric ID. |
| `GITHUB_APP_PRIVATE_KEY` | The PEM‑encoded private key for your GitHub App. |
| `GITHUB_TOKEN_MASTER_KEY` | A random key used to encrypt GitHub OAuth tokens (not used with the App flow but retained for future use). |
| `NETLIFY_TOKEN_MASTER_KEY` | A random key used to encrypt Netlify tokens. |

The Worker also requires two bindings defined in `wrangler.toml`:

* **KV namespace**: `kaixu-secrets` – used to store encrypted provider tokens.
* **R2 bucket**: `kaixu-evidence` – used to store evidence ZIP files.

### Cloudflare Access hardening

If you protect the Worker domain with Cloudflare Access, the Worker now validates Access JWTs when `ACCESS_AUD` is configured in Worker vars.

Required Worker vars:

* `ACCESS_AUD`
* `ACCESS_JWKS_URL`
* `ACCESS_ISSUER`

For machine-to-machine Netlify Function calls to the protected Worker, configure a Cloudflare Access service token and set these Netlify env vars:

* `CF_ACCESS_CLIENT_ID`
* `CF_ACCESS_CLIENT_SECRET`

## Running locally

To run the frontend locally:

```bash
npm install
npm run dev
```

Netlify Functions and the Cloudflare Worker cannot be run directly via `npm run dev`.  They require deployment to their respective environments.  You can test the Worker locally using `wrangler dev`.

## Notes

* The GitHub push flow expects that the user has installed your GitHub App on the target repository.  The user copies the `installation_id` from the GitHub installation page into the **Connect GitHub** modal.
* Evidence exports no longer return base64 blobs.  Instead a signed URL pointing at the R2 object is returned.  The frontend opens this URL in a new tab.
* There are no placeholder strings in this repository.  All configuration values are provided via environment variables and the Worker binding names (`kaixu-secrets`, `kaixu-evidence`).

## Smokehouse & API Playground

The frontend now includes:

* **Smokehouse** panel (in-app) for multi-endpoint health verification.
* **API Playground** panel (in-app) for manual endpoint/method/header/body testing.

Terminal smoke runner:

```bash
cd /workspaces/SuperIDEv2
./scripts/smokehouse.sh https://kaixusuperidev2.netlify.app
```

To include Worker health in the same run:

```bash
WORKER_URL="https://<your-worker-domain>.workers.dev" ./scripts/smokehouse.sh https://kaixusuperidev2.netlify.app
```

See `SMOKEHOUSE.md` for latest recorded smoke output and interpretation.

Smokehouse classification note:

- `Worker Health` returning `302/401/403` is treated as pass when Worker is behind access policy.
- `Generate API` returning `401` is treated as pass for unauthenticated smoke context (auth gate active).

## SkyeDocxPro Enterprise Controls

`/SkyeDocxPro/index.html` now includes enterprise review and governance controls:

- Review Console tabs for Outline, Comments threads, and Timeline snapshots.
- Suggestion Mode toggle with per-document suggestion log.
- Template launcher and metadata editor (author/classification/tags/summary).
- Page-break insertion for structured print and PDF output.
- `.skye` export/import supports optional AES-GCM passphrase encryption.
- Recovery Failsafe Kit (optional) adds recovery-code decrypt path if passphrase is forgotten.

Encrypted `.skye` import prompts for passphrase first, then recovery code fallback when failsafe metadata is available.
Use separate custody for secrets: store passphrase and recovery kit in different secure vault systems.

## SuperIDE + Neural Space Pro Integration

Architecture priority is explicitly enforced:

1. **SuperIDE (Primary app)**
2. **Neural Space Pro (Secondary app)**

Both app modes are hosted in the same frontend surface and both route AI generation through the same backend function path:

* Frontend path: `/api/kaixu-generate`
* Netlify function: `netlify/functions/kaixu-generate.ts`
* Upstream model gateway: `KAIXU_GATEWAY_ENDPOINT`

This means Neural Space Pro mirrors the same governed server-side AI call architecture as the rest of SuperIDE (no client-side provider secrets).

## API Token Issuer (Bulk)

The project now supports org-scoped API tokens for automation.

- `POST /.netlify/functions/token-issue`
  - Body: `{ "count": 50, "ttl_preset": "quarter", "label_prefix": "batch" }`
  - Requires authenticated session cookie.
  - Returns plaintext tokens once (store securely).
- `GET /.netlify/functions/token-list`
  - Returns token metadata only (no plaintext).
- `POST /.netlify/functions/token-revoke`
  - Body: `{ "id": "<token-id>" }`
  - Marks token as revoked.

`/.netlify/functions/kaixu-generate` accepts either session cookie auth or `Authorization: Bearer <issued-token>`.

### Email Lock + Master Sequence

- Issued tokens are email-locked by default to the issuer email.
- Bearer-token calls should include `X-Token-Email: <locked-email>`.
- `TOKEN_MASTER_SEQUENCE` can bypass email lock checks for emergency/admin flows.
- To issue unlocked or custom-email-locked tokens, include `token_master_sequence` in the issue request body.

### Token Scopes

- Default scope is `generate`.
- Supported scopes: `generate`, `deploy`, `export`, `admin`.
- `kaixu-generate` requires `generate` (or `admin`).
- Any scope beyond `generate` requires valid `token_master_sequence` at issue time.

Example scoped token request:

- `{ "count": 5, "ttl_preset": "day", "scopes": ["generate", "export"], "token_master_sequence": "<TOKEN_MASTER_SEQUENCE>" }`

Example locked tester token (2 minutes, default lock to current user):

- `{ "count": 1, "ttl_preset": "test_2m", "label_prefix": "tester" }`

Example custom email lock (requires master sequence):

- `{ "count": 1, "ttl_preset": "1h", "locked_email": "qa@yourorg.com", "token_master_sequence": "<TOKEN_MASTER_SEQUENCE>" }`

Example unlocked token (requires master sequence):

- `{ "count": 1, "ttl_preset": "day", "unlock_email_lock": true, "token_master_sequence": "<TOKEN_MASTER_SEQUENCE>" }`

### TTL Presets

`token-issue` now supports strict duration presets that start immediately at issue time.

- `test_2m` (2 minutes)
- `1h`
- `5h`
- `day`
- `week`
- `month`
- `quarter` / `quarterly`
- `year` / `annual`

Examples:

- 2-minute tester token:
  - `{ "count": 1, "ttl_preset": "test_2m", "label_prefix": "tester" }`
- One-hour batch:
  - `{ "count": 25, "ttl_preset": "1h", "label_prefix": "demo" }`
- Annual token batch:
  - `{ "count": 100, "ttl_preset": "annual", "label_prefix": "prod" }`

Optional fallback fields remain supported:

- `ttl_minutes` (1..525600)
- `ttl_days` (1..365)

### Runtime smoke verification (2026-03-03)

* Netlify endpoint check: `https://kaixu0s.netlify.app/v1/generate`
  * Returned JSON and gateway/auth-layer error response (`502`) with kAIxU headers.
  * Confirms route is deployed and handling requests.
* Worker health check must use your actual deployed Worker URL.
  * Placeholder/non-existent hostnames (for example `kaixu-superide-runner.workers.dev`) will fail DNS.
  * Set `VITE_WORKER_RUNNER_URL` and Netlify `WORKER_RUNNER_URL` to the real Worker domain from `wrangler deploy` output.

### Required env alignment

To keep the architecture stable across both apps:

* Netlify
  * `WORKER_RUNNER_URL` -> exact deployed Worker URL
  * `KAIXU_GATEWAY_ENDPOINT` -> shared AI gateway
  * `KAIXU_APP_TOKEN` -> shared server token
* Frontend build
  * `VITE_WORKER_RUNNER_URL` -> same Worker URL for smoke panel default
  * `VITE_DEFAULT_WS_ID` -> default workspace context used by chat UI

## SkyeMail + SkyeChat Integration (Live)

This repo now includes real backend endpoints for mail delivery and chat notifications:

- `POST /.netlify/functions/skymail-send`
  - Body: `{ "to": "user@example.com", "subject": "...", "text": "...", "channel": "general" }`
  - Sends email via Resend provider adapter.
  - Persists mail record in `app_records` with app=`SkyeMail`.
  - Optional `channel` emits a `SkyeChat` hook record.

- `POST /.netlify/functions/skychat-notify`
  - Body: `{ "channel": "general", "message": "...", "source": "SkyeChat UI" }`
  - Persists chat notification in `app_records` with app=`SkyeChat`.

Required Netlify env vars for mail send:

- `RESEND_API_KEY`
- `SKYE_MAIL_FROM` (recommended; defaults to `SkyeMail <onboarding@resend.dev>`)

SkyeAdmin/SkyeMail/SkyeChat UI in `src/App.tsx` now calls these endpoints directly.

## Team Collaboration + Cross-App Share (Live)

The suite now supports org team onboarding and direct project handoff from the IDE surface.

- `GET /.netlify/functions/team-members`
  - Returns org membership roster (email + role).

- `POST /.netlify/functions/team-invite`
  - Body: `{ "email": "teammate@company.com", "role": "member" }`
  - Requires caller role `owner` or `admin`.
  - Sends secure invite link by email (7-day expiry).

- `POST /.netlify/functions/team-invite-accept`
  - Body: `{ "token": "<invite-token>", "email": "teammate@company.com", "password": "<new-password>" }`
  - Accepts invite, creates/links account, sets org membership role, and signs user in.

- `GET /.netlify/functions/ws-member-list?id=<workspace-id>`
  - Returns workspace-scoped members and roles (`editor`/`viewer`).

- `POST /.netlify/functions/ws-member-set`
  - Body: `{ "ws_id": "<workspace-id>", "email": "teammate@company.com", "role": "editor|viewer|remove" }`
  - Requires caller role `owner` or `admin`.
  - Sets or removes workspace-scoped permissions.

- `POST /.netlify/functions/project-share`
  - Body: `{ "ws_id": "<workspace-id>", "mode": "app|chat|mail|all", "recipient_email": "...", "channel": "general", "note": "..." }`
  - Validates org/workspace ownership.
  - Persists app share record and can fan out to SkyeChat and SkyeMail.

- `POST /.netlify/functions/skychat-kaixu`
  - Body: `{ "channel": "general", "message": "...", "ws_id": "<workspace-id>" }`
  - Persists user message, requests kAIxU response via gateway, persists assistant reply in SkyeChat room history.

Frontend behavior in `src/App.tsx`:

- Every app now includes a built-in tutorial checklist.
- IDE editor pane includes a "Project Share" panel for one-step team handoff.
- SkyeAdmin includes secure invite-link + roster refresh + workspace permission controls.
- SkyeChat includes "Send + Ask kAIxU" for mixed human + assistant room workflows.

## SkyeDocxPro Integration (Live)

`SkyeDocxPro` is now integrated as a first-class app inside the IDE while keeping legacy `SkyeDocs` intact.

- Embedded path in SuperIDE: select `SkyeDocxPro` from app list.
- Standalone path: `/SkyeDocxPro/index.html`
- Product page path: `/SkyeDocxPro/homepage.html`

Build/runtime asset sync:

- `npm run sync:docxpro` copies `SkyeDocxPro/` into `public/SkyeDocxPro/`
- `predev` and `prebuild` run this automatically

## Skye Standard

Skye Standard is the canonical runtime contract for this repository.

### 1) Runtime Topology

- Client apps (SkyeIDE + additional apps) call Netlify Functions as the auth/policy gate.
- Netlify Functions call the Cloudflare Worker runner for privileged execution.
- Worker handles vault + execution + evidence workloads.

### 2) URL Matrix (Canonical)

- Netlify site (current): `https://kaixusuperidev2.netlify.app`
- Worker health route pattern: `https://<worker-domain>/health`
- Worker example from smoke docs: `https://kaixu-superide-runner.skyesoverlondon.workers.dev/health`
- AI generate API from frontend: `/api/kaixu-generate`
- Token APIs:
  - `/.netlify/functions/token-issue`
  - `/.netlify/functions/token-list`
  - `/.netlify/functions/token-revoke`

### 3) Auth & Token Gate

- Session cookie auth (`kx_session`) is supported.
- Bearer token auth is supported for automation.
- Tokens are email-locked by default.
- Email lock bypass or custom lock requires `TOKEN_MASTER_SEQUENCE`.
- Scope beyond `generate` requires `TOKEN_MASTER_SEQUENCE`.

### 4) Token TTL Standard

- Supported presets: `test_2m`, `1h`, `5h`, `day`, `week`, `month`, `quarter|quarterly`, `year|annual`.
- `starts_at` is immediate issue time; `expires_at` is hard stop.
- Expired tokens are invalid forever unless reissued.

### 5) Token Scope Standard

- Supported scopes: `generate`, `deploy`, `export`, `admin`.
- `kaixu-generate` requires `generate` or `admin`.

### 6) Worker Standard

- Worker is the hosted execution brain.
- Netlify remains auth/policy gate.
- Additional apps can reuse the same Worker if they pass through gate policy.

### 7) SKNore Standard

- SKNore patterns define AI-off-limits files.
- Protected files are excluded from AI payloads.
- Protected active file cannot be targeted for AI generation.
- Architecture doc: `SKNore/ARCHITECTURE.md`.

### 8) Environment Standard

- Netlify envs (minimum):
  - `NEON_DATABASE_URL`
  - `KAIXU_GATEWAY_ENDPOINT`
  - `KAIXU_APP_TOKEN`
  - `WORKER_RUNNER_URL`
  - `RUNNER_SHARED_SECRET`
  - `TOKEN_MASTER_SEQUENCE`
  - optional Access service-token vars when Worker is Access-protected
- Worker envs/secrets include:
  - `RUNNER_SHARED_SECRET`
  - `NEON_DATABASE_URL`
  - `EVIDENCE_SIGNING_KEY`
  - `GITHUB_APP_ID`
  - `GITHUB_APP_PRIVATE_KEY`
  - `GITHUB_TOKEN_MASTER_KEY`
  - `NETLIFY_TOKEN_MASTER_KEY`

### 9) Database Standard

- `api_tokens` includes `locked_email` and `scopes_json`.
- Apply latest `db/schema.sql` before relying on token lock/scope features.

## Readiness Docs

- Hardening backlog: `docs/HARDENING_TODO.md`
- Supreme smoke runbook: `docs/SUPREME_SMOKE_RUNBOOK.md`
- Enterprise device/procurement readiness: `docs/ENTERPRISE_DEVICE_READINESS.md`

