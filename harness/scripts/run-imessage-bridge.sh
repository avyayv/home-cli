#!/bin/zsh
set -euo pipefail

cd /Users/avyay/home-automation/harness
export PATH="/Users/avyay/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
printf '\033]0;imessage-pi-agent-bridge\007'

exec /opt/homebrew/bin/pnpm dev:imessage
