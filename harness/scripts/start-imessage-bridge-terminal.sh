#!/bin/zsh
set -euo pipefail

if pgrep -f "/Users/avyay/home-automation/harness/scripts/run-imessage-bridge.sh" >/dev/null 2>&1; then
  exit 0
fi

/usr/bin/osascript <<'APPLESCRIPT'
tell application "Terminal"
  activate
  do script "/Users/avyay/home-automation/harness/scripts/run-imessage-bridge.sh"
end tell
APPLESCRIPT
