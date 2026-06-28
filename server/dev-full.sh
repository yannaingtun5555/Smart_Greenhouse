#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD="$ROOT/dashboard"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "Starting Django API on :8000…"
(
  cd "$DASHBOARD"
  if [[ -d .venv ]]; then
    # shellcheck disable=SC1091
    source .venv/bin/activate
  fi
  export ALLOWED_HOSTS="${ALLOWED_HOSTS:-*}"
  export FRONTEND_DIR="$ROOT/../frontend/dist"
  python manage.py runserver 0.0.0.0:8000
) &
BACKEND_PID=$!

# Wait until API responds
for _ in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8000/api/v1/greenhouses/ >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo
echo "════════════════════════════════════════════"
echo "  GreenMind full stack (dev mode)"
echo "  UI (hot reload): http://127.0.0.1:5173"
echo "  API:             http://127.0.0.1:8000"
echo "════════════════════════════════════════════"
echo

exec "$ROOT/dev-frontend.sh"
