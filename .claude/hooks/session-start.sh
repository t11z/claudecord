#!/bin/bash
set -euo pipefail

# Only relevant for Claude Code on the web / remote environments.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm workspaces monorepo (packages/bot, packages/dashboard, docs) — a single
# install at the root covers all three. Skip if node_modules already looks
# up to date, so a warm container doesn't pay the install cost every session.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  npm install
fi
