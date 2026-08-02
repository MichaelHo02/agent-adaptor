#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTO_AUTH=false
RUN_SMOKE=false

usage() {
  cat <<'EOF'
Usage:
  scripts/reinstall-plugin.sh [--auth] [--smoke] [--help]

Options:
  --auth    Launch browser login via Cursor CLI before install.
  --smoke   Run npm run smoke after install.
  --help    Show this help message.

Environment:
  CURSOR_API_KEY or CURSOR_API_KEY_FILE can be set beforehand.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auth)
      AUTO_AUTH=true
      ;;
    --smoke)
      RUN_SMOKE=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1"
      usage
      exit 2
      ;;
  esac
  shift
done

cd "$ROOT_DIR"

echo "==> Install dependencies"
npm install

echo "==> Build MCP bundle"
npm run build

if [[ "$AUTO_AUTH" == true ]]; then
  echo "==> Launch browser auth flow"
  npm run cursor-auth
fi

echo "==> Install plugin into Codex"
codex plugin marketplace add "$ROOT_DIR"
codex plugin add agent-adaptor@agent-adaptor

if [[ "$RUN_SMOKE" == true ]]; then
  echo "==> Run MCP smoke test"
  npm run smoke
fi

echo "==> Done. Restart Codex task so MCP process picks up env vars if needed."
