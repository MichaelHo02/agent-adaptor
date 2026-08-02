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
  CURSOR_API_KEY can be set as an override.
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

echo "==> Refresh plugin cachebuster"
node -e '
const fs = require("node:fs");
const path = process.argv[1];
const manifest = fs.readFileSync(path, "utf8");
const version = `${JSON.parse(manifest).version.replace(/\+codex\..*$/, "")}+codex.${Date.now()}`;
fs.writeFileSync(path, manifest.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`));
' "$ROOT_DIR/plugins/agent-adaptor/.codex-plugin/plugin.json"

echo "==> Install plugin into Codex"
codex plugin marketplace add "$ROOT_DIR"
codex plugin add agent-adaptor@agent-adaptor

if [[ "$RUN_SMOKE" == true ]]; then
  echo "==> Run MCP smoke test"
  npm run smoke
fi

echo "==> Done. Fully restart Codex, then start a new task so it loads this plugin cache version."
