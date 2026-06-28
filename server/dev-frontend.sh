#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$ROOT/../frontend"

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "Vite dev UI:  http://127.0.0.1:5173"
if [[ -n "${LAN_IP}" ]]; then
  echo "Network UI:   http://${LAN_IP}:5173"
fi
echo "API proxy →   http://127.0.0.1:8000 (start backend with server/dev.sh)"
echo

cd "$FRONTEND"
exec bun run dev
