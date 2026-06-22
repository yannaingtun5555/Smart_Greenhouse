#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$ROOT/../frontend"

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -n "${LAN_IP}" ]]; then
  echo "Local:   http://127.0.0.1:5500"
  echo "Network: http://${LAN_IP}:5500"
  echo "API:     http://${LAN_IP}:8000 (start server/dev.sh separately)"
else
  echo "Serving frontend on http://0.0.0.0:5500"
fi
echo

cd "$FRONTEND"
exec python3 -m http.server 5500 --bind 0.0.0.0
