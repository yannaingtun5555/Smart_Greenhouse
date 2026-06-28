#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD="$ROOT/dashboard"
FRONTEND="$ROOT/../frontend"
FRONTEND_DIST="$FRONTEND/dist"

export ALLOWED_HOSTS="${ALLOWED_HOSTS:-*}"

# Build React app if dist is missing or older than source
if [[ ! -f "$FRONTEND_DIST/index.html" ]] || find "$FRONTEND/src" -newer "$FRONTEND_DIST/index.html" -print -quit 2>/dev/null | grep -q .; then
  echo "Building frontend (bun run build)…"
  (cd "$FRONTEND" && bun run build)
fi
export FRONTEND_DIR="$FRONTEND_DIST"

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "Frontend + API: http://127.0.0.1:8000"
if [[ -n "${LAN_IP}" ]]; then
  echo "Network:        http://${LAN_IP}:8000"
fi
echo "Tip: for hot-reload dev, run server/dev-full.sh instead"
echo

cd "$DASHBOARD"
if [[ -d .venv ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

exec python manage.py runserver 0.0.0.0:8000
