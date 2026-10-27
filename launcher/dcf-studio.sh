#!/usr/bin/env bash
# DCF Studio launcher (used by the applications-menu entry).
#
#   dcf-studio.sh [open [page]]   start the server if needed, open the browser (default)
#   dcf-studio.sh start|stop [--force]|restart [--force]|status|logs
#
# The server runs in its own session (setsid), so it keeps running -- and agent
# runs keep going -- after the browser, a terminal or a Claude session closes.
# `stop`/`restart` refuse while DCF runs are in progress unless --force.
set -uo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
PORT=8765
URL="http://127.0.0.1:$PORT"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/dcf-studio"
LOG="$STATE/server.log"
mkdir -p "$STATE"

# Menu launches get a minimal environment: make sure the CLIs (claude, codex,
# grok, uv in ~/.local/bin) and node (for building the UI) are on PATH.
export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
for nb in "$HOME"/.nvm/versions/node/v20.18.0/bin "$HOME"/.nvm/versions/node/v22*/bin; do
  [ -d "$nb" ] && { export PATH="$PATH:$nb"; break; }
done

healthy() { curl -sf -m 2 "$URL/api/health" >/dev/null 2>&1; }
notify() {
  echo "$1"
  command -v notify-send >/dev/null && notify-send -i dcf-studio -a "DCF Studio" "DCF Studio" "$1" 2>/dev/null
  return 0
}
active_runs() {
  curl -sf -m 3 "$URL/api/runs?active=true" \
    | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0
}
server_pid() { ss -ltnp 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2; }

start() {
  healthy && return 0
  if [ ! -f "$APP_DIR/web/dist/index.html" ]; then
    notify "Building the web UI (first start, ~1 min)…"
    (cd "$APP_DIR/web" && npm install --no-audit --no-fund && npm run build) >>"$LOG" 2>&1 \
      || { notify "UI build failed — see $LOG"; return 1; }
  fi
  cd "$APP_DIR" || return 1
  echo "=== $(date -Is) starting DCF Studio" >>"$LOG"
  setsid nohup uv run uvicorn server.main:app --host 127.0.0.1 --port "$PORT" >>"$LOG" 2>&1 </dev/null &
  for _ in $(seq 1 80); do
    healthy && return 0
    sleep 0.5
  done
  notify "The server didn't start — see $LOG"
  return 1
}

stop() {
  healthy || { echo "DCF Studio is not running"; return 0; }
  local n
  n=$(active_runs)
  if [ "$n" != "0" ] && [ "${1:-}" != "--force" ]; then
    notify "$n run(s) still in progress — not stopping the server (use: stop --force)"
    return 1
  fi
  local pid
  pid=$(server_pid)
  [ -n "$pid" ] && kill "$pid"
  for _ in $(seq 1 40); do
    healthy || { notify "Server stopped"; return 0; }
    sleep 0.5
  done
  notify "The server did not stop (pid $pid)"
  return 1
}

case "${1:-open}" in
  open)
    start || exit 1
    xdg-open "$URL/${2:-}" >/dev/null 2>&1 &
    ;;
  start) start && echo "DCF Studio running at $URL" ;;
  stop) stop "${2:-}" ;;
  restart) stop "${2:-}" && start && notify "Server restarted" ;;
  status)
    if healthy; then echo "running at $URL (pid $(server_pid)), $(active_runs) active run(s)"; else echo "not running"; fi
    ;;
  logs) xdg-open "$LOG" >/dev/null 2>&1 & ;;
  *) echo "usage: $0 [open [page]|start|stop [--force]|restart [--force]|status|logs]"; exit 2 ;;
esac
