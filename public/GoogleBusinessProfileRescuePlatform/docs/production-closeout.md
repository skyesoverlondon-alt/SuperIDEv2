# Production Closeout

This phase is the release-closeout pass.

## What changed
- strict auth is the default in worker vars
- cases are now constrained by workspace ownership and user identity
- live resource wiring has explicit Cloudflare env placeholders
- release readiness and smoke routes exist for operator verification
- closeout scripts were added for migrations, secret generation, and smoke

## Release bar
A release is only considered ready when:
1. D1, KV, R2 and queue bindings are live.
2. `REQUIRE_AUTH_STRICT=true` in the deployed worker.
3. smoke suite passes against the real worker URL.
4. at least one real case can be created, diagnosed, and exported under an authenticated workspace.
