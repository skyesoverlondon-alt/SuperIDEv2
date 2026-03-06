---
description: "Run the standard release gate sequence (check:* + test:* + smoke) and summarize pass/fail with actionable next steps."
name: "Release Gate"
argument-hint: "Optional: site-url worker-url"
agent: "agent"
---
Run the SuperIDE release gate sequence in order, then produce a concise release verdict.

If arguments are provided, treat them as:
- `site-url`: deployed Netlify site URL
- `worker-url`: deployed Worker URL

If arguments are not provided:
- Run all local checks/tests first.
- For smokehouse, either use defaults from script/env or clearly state smoke was skipped due to missing URLs.

## Gate Order
1. `npm run check:gateway-only`
2. `npm run check:protected-apps`
3. `npm run check:provider-strings`
4. `npm run check:secure-defaults`
5. `npm run test:gateway-shape`
6. `npm run test:auth-regression`
7. `npm run test:export-import-schema`
8. `npm run smoke:interactions`
9. `./scripts/smokehouse.sh <site-url> <worker-url>` (if URLs available)

## Output Format
- `Verdict`: `PASS`, `PASS WITH SKIPS`, or `FAIL`
- `Executed`: list each command with pass/fail
- `Skipped`: list skipped commands and reason
- `Failures`: top failing command(s) and likely root cause
- `Next Actions`: numbered, minimal remediation steps

## Constraints
- Do not reorder gate sequence unless a command is unavailable.
- Do not hide skips or failures.
- Keep the report compact and actionable.
