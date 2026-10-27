#!/usr/bin/env bash
# Start DCF Studio: builds the frontend if needed, then serves everything at
# http://127.0.0.1:8765 (localhost only -- the server launches autonomous agents).
#   ./run.sh          build web/ if missing, start server
#   ./run.sh dev      API server + Vite dev server (hot reload) on :5173
set -euo pipefail
cd "$(dirname "$0")"
source ~/.nvm/nvm.sh >/dev/null 2>&1 && nvm use 20.18.0 >/dev/null 2>&1 || true
if [[ "${1:-}" == "dev" ]]; then
  uv run uvicorn server.main:app --host 127.0.0.1 --port 8765 --reload --reload-dir server --reload-dir dcfkit &
  trap 'kill $!' EXIT
  (cd web && npm run dev)
else
  if [[ ! -f web/dist/index.html ]]; then (cd web && npm install && npm run build); fi
  exec uv run uvicorn server.main:app --host 127.0.0.1 --port 8765
fi
