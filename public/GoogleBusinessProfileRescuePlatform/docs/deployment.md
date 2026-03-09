# Deployment Notes — Phase 1

## Worker
1. Create a D1 database.
2. Create an R2 bucket.
3. Bind both in `apps/worker-api/wrangler.toml`.
4. Run D1 migrations with Wrangler.
5. Deploy the worker.

## Frontend
1. Deploy `apps/web` to Cloudflare Pages.
2. Set `VITE_API_BASE_URL` to the Worker URL.

## Notes
Phase 1 is already structured for Cloudflare-first deployment. No Netlify-specific plumbing is present.
