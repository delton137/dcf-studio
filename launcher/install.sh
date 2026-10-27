#!/usr/bin/env bash
# Install (or refresh) the "DCF Studio" entry in the desktop applications menu.
#   ./launcher/install.sh            install
#   ./launcher/install.sh --remove   uninstall
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
LAUNCH="$HERE/dcf-studio.sh"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor"
DESKTOP="$APPS/dcf-studio.desktop"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/dcf-studio"

if [ "${1:-}" = "--remove" ]; then
  rm -f "$DESKTOP" "$ICONS/scalable/apps/dcf-studio.svg"
  update-desktop-database "$APPS" 2>/dev/null || true
  echo "removed"
  exit 0
fi

chmod +x "$LAUNCH"
mkdir -p "$APPS" "$ICONS/scalable/apps" "$STATE"
cp "$HERE/dcf-studio.svg" "$ICONS/scalable/apps/dcf-studio.svg"
touch "$STATE/server.log"

cat >"$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=DCF Studio
GenericName=DCF model workbench
Comment=Run, compare and update DCF models from Claude Code, Codex and Grok; screen stocks
Exec="$LAUNCH" open
Icon=dcf-studio
Terminal=false
StartupNotify=false
Categories=Office;Finance;
Keywords=dcf;valuation;stocks;screener;finance;claude;codex;grok;
Actions=Screener;Runs;Restart;Stop;Logs;

[Desktop Action Screener]
Name=Open Screener
Exec="$LAUNCH" open screener

[Desktop Action Runs]
Name=Open Runs
Exec="$LAUNCH" open runs

[Desktop Action Restart]
Name=Restart server (waits for running DCF runs)
Exec="$LAUNCH" restart

[Desktop Action Stop]
Name=Stop server (refuses while runs are in progress)
Exec="$LAUNCH" stop

[Desktop Action Logs]
Name=Show server log
Exec="$LAUNCH" logs
EOF
chmod +x "$DESKTOP"
command -v desktop-file-validate >/dev/null && desktop-file-validate "$DESKTOP" || true
update-desktop-database "$APPS" 2>/dev/null || true
[ -f "$ICONS/index.theme" ] && gtk-update-icon-cache -f -t "$ICONS" 2>/dev/null || true
echo "installed $DESKTOP"
