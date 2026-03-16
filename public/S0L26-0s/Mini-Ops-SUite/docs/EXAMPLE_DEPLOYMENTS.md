# Example Deployments

## A) Netlify (offline-only)

- Deploy as a static site
- No database required
- No env vars required

Recommended for:
- single-user usage
- preloaded laptops/tablets

## B) Netlify + Neon (SkyeSync enabled)

- Netlify publishes `public/`
- Netlify Functions are in `netlify/functions/`
- Neon provides Postgres

Steps:
1) Run `sql/sync_schema.sql` in Neon
2) Set env vars (see `ENV.example`)
3) Deploy/redeploy
4) Use `/sync/`

Recommended for:
- multi-device
- small teams

## C) Local function testing (Netlify CLI)

Requirements:
- Netlify CLI installed
- A real Postgres DB (Neon)

Steps:
1) Copy `ENV.example` → `.env` locally (do not commit)
2) Run:
   - `netlify dev`
3) Visit the local URL and test `/sync/`

