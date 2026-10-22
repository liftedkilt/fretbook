#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
if [ ! -f web/dist/index.html ]; then
  (cd web && npm ci && npm run build)
fi
exec .venv/bin/python -m fretbook
