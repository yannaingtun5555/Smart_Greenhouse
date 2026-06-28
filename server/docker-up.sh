#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$ROOT/../frontend"
COMPOSE_ARGS=(up --build -d)

usage() {
  cat <<'EOF'
Usage: ./docker-up.sh [options]

Start the full GreenMind stack (frontend build + Django + Postgres + Redis + MQTT).

Options:
  --dev       Also start Vite on :5173 (hot reload, proxies API to Django)
  --build-ui  Build frontend on host with bun before compose (faster if bun installed)
  --logs      Follow logs after start
  -h, --help  Show this help

URLs after start:
  App (production build):  http://localhost:8000
  Dev UI (--dev):          http://localhost:5173
EOF
}

DEV=false
HOST_BUILD=false
LOGS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev) DEV=true; shift ;;
    --build-ui) HOST_BUILD=true; shift ;;
    --logs) LOGS=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if $HOST_BUILD && command -v bun >/dev/null 2>&1; then
  echo "Building frontend on host…"
  (cd "$FRONTEND" && bun install && bun run build)
fi

if $DEV; then
  COMPOSE_ARGS+=(--profile dev)
fi

echo "Starting Docker Compose stack…"
cd "$ROOT"
docker compose "${COMPOSE_ARGS[@]}"

echo
echo "════════════════════════════════════════════"
echo "  GreenMind stack is starting"
echo "  App:  http://localhost:8000"
if $DEV; then
  echo "  Dev:  http://localhost:5173  (Vite → Django API)"
fi
echo "════════════════════════════════════════════"
echo
echo "Check status:  docker compose ps"
echo "View logs:     docker compose logs -f django"
echo "Stop stack:    docker compose down"
echo

if $LOGS; then
  exec docker compose logs -f django mqtt_worker
fi
