# Skye Mini Ops Suite (Offline‑First PWA + Optional SkyeSync)

Build: **20260222-011900-PHX** • Schema: **v8**

This project is a **local-first**, installable PWA (no accounts required) with 3 tools:

- **SkyeNote Vault** — notes + tags + search + exports
- **SkyeCash Ledger** — income/expense ledger + KPIs + CSV export
- **SkyeFocus Log** — pomodoro + session logging + stats

By default it is **offline-only**: everything stays in your browser (IndexedDB). ✅

## Optional SkyeSync (turn-on, not required)

SkyeSync adds:

- **Multi-device sync (E2EE)** — server stores ciphertext only
- **RBAC** — owner / admin / editor / viewer
- **Per-vault ACL** — restrict a vault so only granted members can sync it
- **CRDT-style auto-merge** for non-locally-encrypted vault data
- **Signed update channel** — verifies update metadata before trusting it

### v7+ security upgrade: per-vault key rotation (limited scope)

When you revoke a member, owners/admins can optionally rotate **per-vault keys** for selected vaults.

- Only the selected vaults are re-encrypted (limited scope)
- Rotations increment a per-vault `key_rev`
- Vault envelopes include `vaultKeyRev`, so devices auto-refresh the wrapped vault key when needed

## Docs

- `docs/SETUP_GUIDE.md` — full setup (offline-only + SkyeSync)
- `docs/SECURITY_MODEL.md` — key hierarchy (EDEK → VDEK), ACL, rotation
- `docs/EXAMPLE_DEPLOYMENTS.md` — deployment patterns
- `SUPPORT.md` — troubleshooting + recovery
- `ENV.example` — env var template

## Folder layout

- `public/` — static site (Netlify publish directory)
- `netlify/functions/` — SkyeSync API (optional)
- `sql/` — Postgres schema + migrations
- `tools/` — update signing utilities (private key stays out of `public/`)

## Deploy (Netlify)

### A) Offline-only (no sync)

1) Deploy the site (Netlify Drop is fine).
2) Open once online to prime the PWA cache.
3) Install as an app.

### B) Enable SkyeSync (E2EE + RBAC)

1) Create Postgres (Neon recommended) and get `DATABASE_URL`.
2) Run `sql/sync_schema.sql`.
3) If upgrading, run migrations up to latest (currently `sql/migrate_v8.sql`).
4) Set env vars (see `ENV.example`).
5) Redeploy.
6) Open `/sync/`.

## Signed update channel

Deployed files:
- `public/updates/latest.json`
- `public/updates/latest.sig`
- `public/updates/public.jwk`

Offline signing:

Publisher workflow:
- `tools/README_RELEASE.md`

**Never** ship the private signing key inside a distributable ZIP.

