# Architecture — Phase 1

## Frontend
React + Vite app served from Cloudflare Pages.

## API
Cloudflare Worker using Hono.

## Data
D1 is the primary data store for cases.
When D1 is not bound, a memory store is used for local development.

## Files
R2 is reserved for evidence files.

## Planned next additions
- Stripe checkout + webhook processing
- Cron-driven listing monitoring
- audit event stream
- export bundles
- org and role model
