#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_SMOKE=false

usage() {
  cat <<'EOF'
Usage:
  scripts/reinstall-plugin.sh [--smoke] [--help]

Options:
  --smoke   Run npm run smoke after install.
  --help    Show this help message.

Environment:
  CURSOR_API_KEY or CURSOR_API_KEY_FILE can be set beforehand.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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

echo "==> Install plugin into Codex"
codex plugin marketplace add "$ROOT_DIR"
codex plugin add agent-adaptor@agent-adaptor

if [[ "$RUN_SMOKE" == true ]]; then
  echo "==> Run MCP smoke test"
  npm run smoke
fi

echo "==> Done. Set CURSOR_API_KEY or CURSOR_API_KEY_FILE for the MCP process, then restart the Codex task."
