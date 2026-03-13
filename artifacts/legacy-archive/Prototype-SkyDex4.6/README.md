# Skye Codex IDE · Env Build

This version moves secret-bearing configuration out of the browser UI and into environment variables.

Important: this build uses Netlify Functions for the Codex lane, GitHub push, and Netlify deploy actions.

Lord kAIxu, this must be deployed via Git or it will not be useful to you.

## What changed

- The OpenAI API key is no longer stored in the browser.
- The GitHub PAT is no longer stored in the browser.
- The Netlify PAT is no longer stored in the browser.
- The UI still keeps non-secret targeting fields such as owner, repo, branch, path, and site id.
- Live preview still works entirely in-browser.
- JSON export and ZIP export still work entirely in-browser.

## Why this is the correct architecture

OpenAI's official API docs say API keys are secrets and should not be exposed in client-side code, and that they should be loaded from environment variables or key management on the server. The docs also describe the Responses API as the current general generation surface, while the old Assistants API is deprecated and scheduled for removal in August 2026. citeturn1search0turn0search0

So the previous all-client version was convenient, but for real use it was a tiny carnival of exposed secrets. This version fixes that.

## Environment variables

Copy `.env.example` into your Netlify site environment variables:

- `OPENAI_API_KEY`
- `OPENAI_CODEX_MODEL`
- `OPENAI_RESPONSES_URL`
- `GITHUB_TOKEN`
- `DEFAULT_GH_OWNER`
- `DEFAULT_GH_REPO`
- `DEFAULT_GH_BRANCH`
- `NETLIFY_TOKEN`
- `DEFAULT_NETLIFY_SITE_ID`

## Deploy on Netlify

1. Put this folder in a Git repo.
2. Push the repo to GitHub.
3. Import the repo into Netlify.
4. Set the environment variables above.
5. Deploy.

## Function routes

- `/.netlify/functions/config`
- `/.netlify/functions/codex`
- `/.netlify/functions/github-test`
- `/.netlify/functions/github-push`
- `/.netlify/functions/netlify-test`
- `/.netlify/functions/netlify-deploy`

## Notes on the OpenAI model setting

I did not hard-code a single magical Codex model name because the current OpenAI docs available here clearly show Codex as a product/documentation surface and recommend the modern Responses API, but they do not give me a reliable single immutable code-model string to freeze into your app from this environment. So the clean move is to keep `OPENAI_CODEX_MODEL` configurable. That avoids fossilizing stale nonsense into your build. citeturn1search0turn2search1turn2search0
