# Auth Hardening

The previous phases allowed a demo fallback user. This closeout phase keeps that only for non-strict local development. Production should run with `REQUIRE_AUTH_STRICT=true`, which disables the fallback and returns `401` when no valid bearer session exists.
