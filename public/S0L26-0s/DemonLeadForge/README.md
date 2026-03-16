# Demon Lead Forge

A Netlify + Neon + OpenAI lead intelligence app with:

- Netlify Identity login and user tracking
- Neon Postgres persistence for projects, sheets, leads, threads, messages, and audit events
- Netlify Blobs storage for exported CSV/JSON snapshots
- Netlify Forms audit trail for scrape submissions and feedback
- OpenAI-powered chat command deck for targeting, refining, and combining lead sets
- Hidden admin vault unlocked by `BEMON_KEY`

## Important deployment note

Skyes Over London, this must be deployed via Git or it will not be useful to you.

This project uses serverless functions, environment variables, Netlify Identity, and Netlify Blobs. A static drag-and-drop deploy will not wire the runtime correctly.

## Environment variables

Set these in Netlify UI with **Functions** scope enabled:

- `OPENAI_API_KEY` - your OpenAI API key
- `OPENAI_MODEL` - optional, defaults to `gpt-5.2-mini`
- `DATABASE_URL` - Neon pooled connection string
- `BEMON_KEY` - the hidden admin unlock key

## Netlify setup

1. Push this folder to GitHub.
2. Import the repo into Netlify.
3. In **Project configuration > Identity**, enable Netlify Identity.
4. In **Project configuration > Identity > Registration**, choose Open or Invite only.
5. Add the environment variables above.
6. Redeploy.
7. Open the site and log in.

## Neon setup

You have two options:

### Option A: let the app self-bootstrap

The functions auto-create tables on first authenticated use.

### Option B: run the SQL yourself

Paste `sql/schema.sql` into the Neon SQL editor and run it once.

## What the app does

- Scrapes public HTML pages on a target site
- Crawls same-domain internal pages up to a page limit
- Extracts emails, phones, websites, page titles, structured business info, and candidate addresses
- Saves sheet rows into Postgres
- Saves CSV and JSON snapshots into Netlify Blobs
- Lets users open two sheets side-by-side
- Lets users combine and deduplicate sheets into a new sheet
- Lets users use AI chat to refine targets and, when asked, auto-combine selected sheets
- Tracks authenticated users and logs key activity into the admin vault

## Notes on scraping

This scraper is built for public pages and public contact data. It will work best on server-rendered pages, directories, member profiles, location pages, contact pages, and simple business sites. Heavily client-rendered sites can hide data from a normal HTTP fetch, because the function does not run a full browser.

## Admin vault

The admin vault is separate from Netlify login.

- Click **Admin Vault** in the app
- Enter the `BEMON_KEY`
- The server issues a signed temporary admin session token
- Admin views can inspect tracked users, audit events, recent sheets, and recent threads

## Forms included

The app submits Netlify Forms entries for:

- scrape requests
- feedback

This gives you a second audit trail in the Netlify dashboard.

## Files

- `public/` - static UI
- `netlify/functions/` - serverless runtime
- `sql/schema.sql` - manual schema setup option

