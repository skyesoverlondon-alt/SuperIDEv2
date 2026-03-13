The main SuperIDE database schema owns the active production path. Apply `db/schema.sql` from the project root for active deployments.
# Skyes Over London LC — Contractor Network Console

This surface now rides the shared SuperIDE runtime instead of its own sidecar Netlify Functions stack.

Single HTML console: `/index.html`

Backed by:
- Main runtime Neon/Postgres path for submissions + admin workflow
- Main runtime Netlify Blobs attachment lane
- Main runtime admin/auth endpoints under `/api/*`

## Required main runtime env vars
- NEON_DATABASE_URL
- ADMIN_PASSWORD
- ADMIN_JWT_SECRET

Optional:
- ADMIN_EMAIL_ALLOWLIST (comma separated)
- ADMIN_IDENTITY_ANYONE=true (not recommended)

## Neon
The main SuperIDE database schema owns the active production path. Apply `db/schema.sql` from the project root for active deployments.

## Local dev
Run the main repo from the root so `/api/intake` and `/api/admin/*` resolve against the shared Netlify Functions runtime.
