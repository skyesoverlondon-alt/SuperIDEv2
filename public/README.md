# Skyes Over London LC — Contractor Network Console (Neon + Blobs)

Lord kAIxu, this must be deployed via Git or it will not be useful to you.

Single HTML console: `/index.html`

Backed by:
- Neon Postgres (submissions + admin workflow)
- Netlify Blobs (attachments)
- Netlify Forms (admin-login attempt trail)
- Netlify Identity (optional allowlisted admin lane)

## Required Netlify env vars
- DATABASE_URL
- ADMIN_PASSWORD
- ADMIN_JWT_SECRET

Optional:
- ADMIN_EMAIL_ALLOWLIST (comma separated)
- ADMIN_IDENTITY_ANYONE=true (not recommended)

## Neon
Run `db/schema.sql` in the main project root in Neon SQL editor.

## Local dev
npm install
npx netlify dev
