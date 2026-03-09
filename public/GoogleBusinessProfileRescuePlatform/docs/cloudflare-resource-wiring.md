# Cloudflare Resource Wiring

Populate the following before deploy:

- `CF_ACCOUNT_ID`
- `CF_D1_DATABASE_ID`
- `CF_KV_NAMESPACE_ID`
- `CF_R2_BUCKET_NAME`
- `SIGNING_SECRET`
- `COOKIE_SIGNING_SECRET`

Then bind the D1 database, KV namespace, R2 bucket and queue in `wrangler.toml`.
