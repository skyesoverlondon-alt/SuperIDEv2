# Basic Support & Troubleshooting

This package is designed to be low-maintenance. When something breaks, the fastest path is usually: validate env vars → validate DB schema → validate that the device still has keys.

## Quick triage checklist

1) Are you offline?
- Sync requires online access. Offline-only usage is fine.

2) Did the browser clear storage?
- If storage was cleared, device keys are gone.
- Re-join the org and have owner/admin grant access again.

3) DB schema up to date?
- Fresh deploy: `sql/sync_schema.sql`
- Upgrades: run migrations up to the latest (currently `sql/migrate_v8.sql`)

4) Env vars set on Netlify?
- `DATABASE_URL`
- `SYNC_JWT_SECRET`
- `SYNC_INVITE_SECRET`

## Common Sync messages

- `token-stale` → org token version changed (revocation/rotation). Re-auth occurs automatically; if stuck, disable+re-enable sync.
- `sync-key-pending` → owner/admin must click “Grant access” for that member.
- `sync-offline-vaultkey` → device needs to fetch updated vault key but is offline.
- `sync-epoch-mismatch-vault` → org epoch rotated; device must unlock again. Owner may need to rewrap/refresh vault keys.

## Recovery moves (safe)

- **Export suite** from the home page (always safe).
- If Sync is misconfigured, you can disable Sync on the device; local vaults remain.

## “Basic support” scope (what this package includes)

- Clear setup documentation (docs/)
- Environment template (ENV.example)
- Example deployment notes (docs/EXAMPLE_DEPLOYMENTS.md)
- Debuggable error messages + consistent status codes in functions

