#!/bin/zsh
set -euo pipefail

pnpm test
pnpm typecheck
