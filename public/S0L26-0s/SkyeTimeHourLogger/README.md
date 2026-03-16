# SkyeTime: Hour Logger

SkyeTime is a Cloudflare-native operator tracker for work sessions, notes, activity logs, expense receipts, and proof exports.

What is inside:
- single-page PWA with offline IndexedDB persistence
- second-level live timer with project/client/task metadata
- note taker and operator log timeline
- expense capture with receipt photos
- sync lane into Cloudflare D1
- receipt and export storage in R2
- branded PDF proof exports with manifest hash + proof-chain head
- simple optional shared-secret gate for sync/export endpoints

## Stack
- Cloudflare Workers
- D1
- R2
- IndexedDB + service worker for offline usage
- vanilla HTML/CSS/JS so the repo stays easy to ship

## Quick deploy
1. `npm install`
2. Create a D1 database and bind it in `wrangler.jsonc`
3. Create an R2 bucket and bind it in `wrangler.jsonc`
4. Copy `.env.example` to `.dev.vars` for local dev if you want
5. `npm run db:migrate:remote`
6. `npm run deploy`

## Core routes
- `GET /api/health`
- `GET /api/bootstrap`
- `POST /api/sync/batch`
- `POST /api/uploads/receipt`
- `POST /api/exports/pdf`
- `GET /api/exports`
- `GET /api/exports/:id`
- `POST /api/workspace`

## Export proof model
Every synced record is hashed. Each sync also appends an audit event into a chained proof ledger. PDF exports include:
- export timestamp
- manifest SHA-256
- proof-chain head
- per-record hashes
- receipt SHA-256 values where available

That gives contractors and owner-operators a stronger paper trail than a glorified stopwatch pretending to be software.
