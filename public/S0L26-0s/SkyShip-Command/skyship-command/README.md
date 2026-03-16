# SkyShip Command

SkyShip Command is a ZIP-first deployment control surface.

You drop in one full ZIP, inspect the file map, pick a deploy root, and then run one or more lanes:

- GitHub push: pushes the extracted ZIP contents into an existing branch using the Git database API.
- Netlify deploy: uploads the selected deploy root as a manual deploy.
- Cloudflare Pages trigger: requests a fresh deployment for a Git-connected Pages project.
- Ask OpenAI: answers questions about the current ZIP, likely deploy roots, lane order, and failure risks.

## What this build is optimized for

This repo is intentionally simple:

- static front end (`index.html` + `assets/`)
- Netlify Functions backend (`netlify/functions/`)
- no bundler, no compile step, no dependency install needed for the UI

## Important operating behavior

### GitHub lane

- This lane expects an existing repository.
- If the branch already exists, it updates that branch.
- If the branch does not exist, it creates it from the repo default branch.
- The lane uses the ZIP as plumbing and pushes the extracted files, not the original `.zip` blob.

### Netlify lane

- This lane deploys the files under **Deploy root**.
- For source repos, point Deploy root at your built output like `dist`, `build`, `out`, or `public`.
- For plain static ZIPs, leave Deploy root blank and it will deploy from ZIP root.

### Cloudflare lane

- This build triggers a fresh **Cloudflare Pages** deployment for a project that is already connected to Git.
- That means the GitHub push should usually happen first.
- This lane does **not** directly upload the ZIP assets to Cloudflare.

## Deploying this app itself

Deploy this repo to Netlify by Git so the Netlify Functions are live.

Environment variables are optional:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

If you do not set `OPENAI_API_KEY` on the server, the user can still paste a key into the UI and the function will use it for the current request.
