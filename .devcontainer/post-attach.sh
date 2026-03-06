#!/usr/bin/env bash
set -euo pipefail

# Keep runtime sockets in a stable, user-writable directory inside the container.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/vscode-runtime}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR" || true

# Ensure Node toolchain is available in interactive shells.
export NVM_DIR="${NVM_DIR:-/usr/local/share/nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

if ! command -v node >/dev/null 2>&1 && command -v nvm >/dev/null 2>&1; then
  nvm install 20 || true
  nvm alias default 20 || true
  nvm use 20 || true
fi

if command -v npm >/dev/null 2>&1 && ! command -v wrangler >/dev/null 2>&1; then
  npm install -g wrangler@4 || true
fi

NODE_STATE="missing"
WRANGLER_STATE="missing"
if command -v node >/dev/null 2>&1; then
  NODE_STATE="$(node -v)"
fi
if command -v wrangler >/dev/null 2>&1; then
  WRANGLER_STATE="$(wrangler --version 2>/dev/null | head -n 1 || echo available)"
fi

cat <<'MSG'
Fat Wizard devcontainer is live.

Core services:
  - Postgres / pgvector:   db:5432      (host-forward: 5432)
  - Redis:                 redis:6379   (host-forward: 6379)
  - Mailpit SMTP/UI:       mailpit:1025 / 8025
  - MinIO API/Console:     minio:9000 / 9001

Useful browser ports:
  - 3000  Next / Node app
  - 5173  Vite frontend
  - 8000  Python / FastAPI backend
  - 8025  Mailpit inbox UI
  - 9001  MinIO console
  - 11434 Optional Ollama API

Useful commands:
  node -v
  wrangler --version
  python3 --version
  psql postgresql://admin:postgres@db:5432/app -c 'select version();'
  redis-cli -h redis ping
  curl http://mailpit:8025/api/v1/info
  curl http://minio:9000/minio/health/live


Optional infra services (if not already running):
  docker compose -f .devcontainer/docker-compose.yaml up -d db redis mailpit minio

Optional local AI lane:
  docker compose -f .devcontainer/optional-ollama-compose.yaml up -d

Common app starts:
  npm run dev
  python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

Toolchain status:
  - Node: ${NODE_STATE}
  - Wrangler: ${WRANGLER_STATE}
MSG
