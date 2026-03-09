#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f worker/.dev.vars ]]; then
  if [[ -f worker/.dev.vars.docker.example ]]; then
    cp worker/.dev.vars.docker.example worker/.dev.vars
    CREATED_WORKER_ENV=1
  else
    echo "Missing worker/.dev.vars and worker/.dev.vars.docker.example" >&2
    exit 1
  fi
fi

cleanup() {
  if [[ "${CREATED_WORKER_ENV:-0}" == "1" ]]; then
    rm -f worker/.dev.vars
  fi
}
trap cleanup EXIT

docker compose up --build -d db db-http adminer worker netlify

wait_for_url() {
  local label="$1"
  local url="$2"
  local attempts="${3:-40}"
  local sleep_seconds="${4:-2}"
  local code
  for ((i=1; i<=attempts; i+=1)); do
    code="$(curl -sS -o /tmp/docker-smoke-body.txt -w '%{http_code}' "$url" || true)"
    if [[ "$code" =~ ^2|3|4 ]]; then
      printf '%s OK (%s)\n' "$label" "$code"
      return 0
    fi
    sleep "$sleep_seconds"
  done
  echo "$label failed: $url" >&2
  if [[ -f /tmp/docker-smoke-body.txt ]]; then
    cat /tmp/docker-smoke-body.txt >&2 || true
  fi
  return 1
}

echo "Checking SQL proxy"
SQL_PROXY_RESPONSE="$(curl -sS -X POST http://localhost:${SQL_HTTP_PORT:-5540}/sql -H 'Content-Type: application/json' -d '{"query":"select 1 as ok","params":[]}')"
echo "$SQL_PROXY_RESPONSE" | grep -q '"ok":1'

wait_for_url "Worker health" "http://localhost:${WORKER_DEV_PORT:-8787}/health"
wait_for_url "Netlify root" "http://localhost:${NETLIFY_DEV_PORT:-8888}/"
wait_for_url "Netlify health" "http://localhost:${NETLIFY_DEV_PORT:-8888}/api/health"
wait_for_url "Adminer" "http://localhost:${ADMINER_PORT:-8081}/"

echo "Docker smoke passed."