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

### Netlify environment variables

Set the following environment variables in your Netlify site settings:

| Variable | Description |
|---|---|
| `NEON_DATABASE_URL` | The Neon SQL‑over‑HTTP endpoint for your database. |
| `KAIXU_GATEWAY_ENDPOINT` | Your Kaixu Gateway endpoint, e.g. `https://your-gateway/v1/generate`. |
| `KAIXU_APP_TOKEN` | Server token used to call the Kaixu Gateway. |
| `WORKER_RUNNER_URL` | The URL of your deployed Cloudflare Worker (e.g. `https://kaixu-superide-runner.example.workers.dev`). |
| `RUNNER_SHARED_SECRET` | A shared secret used to sign and verify calls between Netlify and the Worker. |
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
