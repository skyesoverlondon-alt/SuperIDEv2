#!/usr/bin/env bash
set -euo pipefail

cd /workspace/worker

if [[ ! -x node_modules/.bin/wrangler ]]; then
  npm ci
fi

exec npx wrangler dev \
  --config wrangler.toml \
  --ip 0.0.0.0 \
  --port "${WORKER_DEV_PORT:-8787}" \
  --local
