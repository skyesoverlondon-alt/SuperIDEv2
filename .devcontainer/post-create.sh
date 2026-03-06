#!/usr/bin/env bash
set -euo pipefail

cd /workspace

echo "[fat-wizard] bootstrapping workspace"

ensure_node_toolchain() {
  export NVM_DIR="${NVM_DIR:-/usr/local/share/nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
  fi

  if ! command -v node >/dev/null 2>&1; then
    if command -v nvm >/dev/null 2>&1; then
      nvm install 20 || true
      nvm alias default 20 || true
      nvm use 20 || true
    fi
  fi

  if command -v node >/dev/null 2>&1; then
    echo "[fat-wizard] node=$(node -v)"
  else
    echo "[fat-wizard] warning: node not found after nvm bootstrap" >&2
  fi

  if command -v npm >/dev/null 2>&1; then
    npm install -g wrangler@4 || true
  else
    echo "[fat-wizard] warning: npm not found; skipping global wrangler install" >&2
  fi

  if [ -f "$HOME/.bashrc" ]; then
    if ! grep -q 'NVM_DIR=.*/usr/local/share/nvm' "$HOME/.bashrc"; then
      {
        echo ''
        echo '# Devcontainer Node bootstrap'
        echo 'export NVM_DIR="/usr/local/share/nvm"'
        echo '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"'
      } >> "$HOME/.bashrc"
    fi
  fi
}

ensure_node_toolchain

corepack enable || true
npm install -g pnpm yarn || true
python3 -m pip install --upgrade pip setuptools wheel || true
python3 -m pip install uv || true

if [ -f .env.sample ] && [ ! -f .env ]; then
  cp .env.sample .env || true
fi
if [ -f .env.example ] && [ ! -f .env.local ]; then
  cp .env.example .env.local || true
fi

if [ -f package.json ]; then
  if [ -f pnpm-lock.yaml ]; then
    pnpm install
  elif [ -f yarn.lock ]; then
    yarn install
  elif [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then
    npm ci || npm install
  else
    npm install
  fi
fi

if [ -f worker/package.json ]; then
  npm --prefix worker install --save-dev wrangler@^4.71.0 || true
fi

if [ -f requirements-dev.txt ]; then
  python3 -m pip install -r requirements-dev.txt || true
fi
if [ -f requirements.txt ]; then
  python3 -m pip install -r requirements.txt || true
fi
if [ -f pyproject.toml ]; then
  python3 -m pip install -e . || true
fi
if [ -f src/backend/pyproject.toml ]; then
  python3 -m pip install -e src/backend || true
fi

echo "[fat-wizard] done"
