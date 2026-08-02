#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/plugins/agent-adaptor"
MARKETPLACE_NAME="agent-adaptor"
PLUGIN_ID="agent-adaptor@$MARKETPLACE_NAME"
USER_DIR="$(python3 -c 'from pathlib import Path; print(Path.home())')"
PLUGIN_CREATOR_DIR="${PLUGIN_CREATOR_DIR:-$USER_DIR/.codex/skills/.system/plugin-creator}"
SKILL_CREATOR_DIR="${SKILL_CREATOR_DIR:-$USER_DIR/.codex/skills/.system/skill-creator}"
CACHEBUSTED=false
INSTALL_COMPLETED=false
INSTALLED_VERIFIED=false

usage() {
  cat <<'EOF'
Usage:
  scripts/reinstall-plugin.sh [--help]

Environment:
  PLUGIN_CREATOR_DIR and SKILL_CREATOR_DIR can override the built-in Codex skill paths.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if [[ $# -ne 0 ]]; then
  echo "Unknown arguments: $*" >&2
  usage >&2
  exit 2
fi

TEMP_DIR="$(mktemp -d)"

on_error() {
  local status=$?
  echo "==> Plugin verification failed." >&2
  if [[ "$CACHEBUSTED" == true && "$INSTALL_COMPLETED" == false ]]; then
    echo "Recovery: the source has a new cachebuster, but Codex was not updated; the previous installation remains active. Fix the error and rerun npm run verify-plugin." >&2
  elif [[ "$INSTALL_COMPLETED" == true && "$INSTALLED_VERIFIED" == false ]]; then
    echo "Recovery: Codex installed the new version, but verification did not finish. Do not use it yet; fix the mismatch and rerun npm run verify-plugin." >&2
  fi
  exit "$status"
}

cleanup() {
  rm -rf "$TEMP_DIR"
}

trap on_error ERR
trap cleanup EXIT

cd "$ROOT_DIR"

echo "==> Validate checkout"
git diff --check HEAD
bash -n scripts/reinstall-plugin.sh
npm run verify-mcp
git diff --check HEAD

if python3 -c 'import yaml' >/dev/null 2>&1; then
  VALIDATOR=(python3)
elif command -v uv >/dev/null 2>&1; then
  VALIDATOR=(uv run --quiet --with pyyaml python)
else
  echo "PyYAML is required by the official validators. Install PyYAML or uv, then rerun." >&2
  exit 1
fi

"${VALIDATOR[@]}" "$PLUGIN_CREATOR_DIR/scripts/validate_plugin.py" "$PLUGIN_DIR"
"${VALIDATOR[@]}" "$SKILL_CREATOR_DIR/scripts/quick_validate.py" "$PLUGIN_DIR/skills/use-agent-adaptor"

echo "==> Confirm local marketplace source"
codex plugin marketplace list --json > "$TEMP_DIR/marketplaces.json"
node - "$TEMP_DIR/marketplaces.json" "$ROOT_DIR" "$MARKETPLACE_NAME" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [jsonPath, expectedRoot, marketplaceName] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const marketplace = payload.marketplaces.find(({ name }) => name === marketplaceName);
if (!marketplace) throw new Error(`Marketplace ${marketplaceName} is not configured`);
if (marketplace.marketplaceSource?.sourceType !== "local") {
  throw new Error(`Marketplace ${marketplaceName} is not local`);
}
if (path.resolve(marketplace.root) !== path.resolve(expectedRoot)) {
  throw new Error(`Marketplace root mismatch: ${marketplace.root}`);
}
const catalog = JSON.parse(fs.readFileSync(path.join(expectedRoot, ".agents/plugins/marketplace.json"), "utf8"));
const entry = catalog.plugins.find(({ name }) => name === "agent-adaptor");
const source = entry?.source;
if (source?.source !== "local") throw new Error("Agent Adaptor marketplace source is not local");
if (path.resolve(expectedRoot, source.path) !== path.resolve(expectedRoot, "plugins/agent-adaptor")) {
  throw new Error(`Agent Adaptor source mismatch: ${source.path}`);
}
NODE

echo "==> Refresh plugin cachebuster"
python3 "$PLUGIN_CREATOR_DIR/scripts/update_plugin_cachebuster.py" "$PLUGIN_DIR"
CACHEBUSTED=true
EXPECTED_VERSION="$(node -p "require('$PLUGIN_DIR/.codex-plugin/plugin.json').version")"

echo "==> Install plugin into Codex"
codex plugin add "$PLUGIN_ID" --json > "$TEMP_DIR/install.json"
INSTALL_COMPLETED=true
cat "$TEMP_DIR/install.json"

read -r INSTALLED_VERSION INSTALLED_PATH < <(node - "$TEMP_DIR/install.json" <<'NODE'
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(`${payload.version} ${payload.installedPath}\n`);
NODE
)

if [[ "$INSTALLED_VERSION" != "$EXPECTED_VERSION" ]]; then
  echo "Installed version mismatch: expected $EXPECTED_VERSION, got $INSTALLED_VERSION" >&2
  exit 1
fi

codex plugin list --json > "$TEMP_DIR/plugins.json"
node - "$TEMP_DIR/plugins.json" "$PLUGIN_ID" "$EXPECTED_VERSION" "$PLUGIN_DIR" "$MARKETPLACE_NAME" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [jsonPath, pluginId, expectedVersion, expectedSource, marketplaceName] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const plugin = payload.installed.find((entry) => entry.pluginId === pluginId);
if (!plugin?.installed || !plugin.enabled) throw new Error(`${pluginId} is not installed and enabled`);
if (plugin.version !== expectedVersion) throw new Error(`Plugin version mismatch: ${plugin.version}`);
if (plugin.marketplaceName !== marketplaceName) {
  throw new Error(`Plugin marketplace mismatch: ${plugin.marketplaceName}`);
}
if (plugin.source?.source !== "local" || path.resolve(plugin.source.path) !== path.resolve(expectedSource)) {
  throw new Error(`Plugin source mismatch: ${plugin.source?.path}`);
}
NODE

echo "==> Compare installed cache"
for relative_path in \
  .codex-plugin/plugin.json \
  .mcp.json \
  .app.json \
  skills/use-agent-adaptor/SKILL.md \
  dist/server.mjs \
  dist/session-panel.html; do
  cmp "$PLUGIN_DIR/$relative_path" "$INSTALLED_PATH/$relative_path"
  echo "matched $relative_path"
done

echo "==> Verify installed MCP server"
node scripts/smoke.mjs --plugin-root "$INSTALLED_PATH"
INSTALLED_VERIFIED=true

echo "==> PASS: installed $PLUGIN_ID $INSTALLED_VERSION at $INSTALLED_PATH"
echo "Fully quit and restart Codex. Then create a genuinely new task and directly call cursor_auth_status and cursor_session; visually confirm the inline panel. Same-process tasks and forks do not validate a post-install registry refresh."
