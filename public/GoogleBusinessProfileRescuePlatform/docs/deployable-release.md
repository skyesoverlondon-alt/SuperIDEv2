# Deployable Release Notes

This release is intended to be deployable on Cloudflare as a full cumulative build.

## What is now real

- D1-backed auth with bootstrap account and session tokens
- Cloudflare Worker deployment config in `apps/worker-api/wrangler.toml`
- `.dev.vars.example` and frontend `.env.example`
- signed export pack metadata
- full cumulative repo preserving phases 1-3

## Bootstrap login

Fresh D1 database default login:

- email: `owner@example.com`
- password: `ChangeMe123!`

Change it immediately after first login in a real deployment.

## Deploy steps

1. `npm install`
2. create D1, KV, and R2 resources in Cloudflare
3. update IDs in `apps/worker-api/wrangler.toml`
4. apply D1 migrations in `infra/migrations`
5. copy `.dev.vars.example` to `.dev.vars`
6. run `npm run verify:release`
7. deploy worker with `npm run deploy:api`
8. deploy frontend to Cloudflare Pages with `apps/web/dist`
