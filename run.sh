#!/usr/bin/env bash
# Starts the bass-tab-sync server (server.py) and prints the URL to open it.
# Run it from anywhere; stop with Ctrl+C.

cd "$(dirname "$(readlink -f "$0")")" || exit 1

PORT=8137
URL="http://127.0.0.1:${PORT}/"

# Bail out early if something is already listening on the port
if ss -ltn "sport = :${PORT}" 2>/dev/null | grep -q LISTEN; then
  echo "Port ${PORT} is already in use (server probably running already)."
  echo "Open: ${URL}"
  exit 0
fi

echo "Open: ${URL}"
exec python3 server.py
