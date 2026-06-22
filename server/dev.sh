#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD="$ROOT/dashboard"
FRONTEND="$ROOT/../frontend"

export FRONTEND_DIR="$FRONTEND"
export ALLOWED_HOSTS="${ALLOWED_HOSTS:-*}"

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -n "${LAN_IP}" ]]; then
  echo "Local:   http://127.0.0.1:8000"
  echo "Network: http://${LAN_IP}:8000"
else
  echo "Open: http://127.0.0.1:8000 (and use this machine's LAN IP from other devices)"
fi
echo

cd "$DASHBOARD"
if [[ -d .venv ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

exec python manage.py runserver 0.0.0.0:8000
