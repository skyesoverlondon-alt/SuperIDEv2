#!/usr/bin/env bash
set -euo pipefail

cd /workspace

if [[ ! -x node_modules/.bin/vite ]]; then
  npm ci
fi

exec netlify dev \
  --context development \
  --port "${NETLIFY_DEV_PORT:-8888}" \
  --target-port "${VITE_DEV_PORT:-5173}" \
  --command "npm run dev -- --host 0.0.0.0 --port ${VITE_DEV_PORT:-5173}"
