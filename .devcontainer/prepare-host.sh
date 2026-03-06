#!/usr/bin/env bash
set -euo pipefail

# Runs on the Docker host before container startup.
# Clear stale compose resources so --no-recreate does not reuse old containers.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "[devcontainer] docker not found on host; skipping stale resource cleanup"
  exit 0
fi

COMPOSE_FILE="$ROOT_DIR/.devcontainer/docker-compose.yaml"
if [ ! -f "$COMPOSE_FILE" ] && [ -f "$ROOT_DIR/1.devcontainer/docker-compose.yaml" ]; then
  COMPOSE_FILE="$ROOT_DIR/1.devcontainer/docker-compose.yaml"
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[devcontainer] compose file not found; skipping cleanup"
  exit 0
fi

PROJECT_NAME="$(basename "$ROOT_DIR" | tr '[:upper:]' '[:lower:]')_devcontainer"

echo "[devcontainer] cleaning stale compose resources for project: $PROJECT_NAME"
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" down --remove-orphans || true
