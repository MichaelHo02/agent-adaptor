# Agent Adaptor

Agent Adaptor is a Codex plugin that delegates coding tasks to Cursor agents running against your current local checkout.

It uses Cursor's official TypeScript SDK through the `cursor` MCP server and exposes four tools:

- `cursor_configure_from_clipboard` securely stores a copied Cursor User API Key on macOS.
- `cursor_run` starts a new Cursor agent.
- `cursor_follow_up` continues the same agent conversation.
- `cursor_auth_status` checks whether the MCP received `CURSOR_API_KEY`.

Cursor can read, edit, and run code in the checkout you pass. Review its changes as you would any other coding agent.

## Requirements

- Node.js 22.13 or newer
- A Cursor plan with SDK access
- A [Cursor User API Key](https://cursor.com/dashboard/api?section=user-keys#user-api-keys)

## Local setup

```sh
git clone https://github.com/MichaelHo02/agent-adaptor.git
cd agent-adaptor
npm install
npm run check
npm run build
codex plugin marketplace add "$PWD"
codex plugin add agent-adaptor@agent-adaptor
```

Start a new Codex task after installation so Codex discovers the plugin tools.

## Cursor API-key configuration

Create and copy a key at [Cursor User API Keys](https://cursor.com/dashboard/api?section=user-keys#user-api-keys), then ask Codex to configure Cursor from your clipboard. Approve the native macOS confirmation dialog. The `cursor_configure_from_clipboard` tool then saves the key to `~/.config/agent-adaptor/.env` with owner-only permissions, clears the clipboard, and enables Cursor immediately.

Alternatively, set `CURSOR_API_KEY` before starting Codex. The plugin never accepts the key as a tool argument or returns it in tool output.

To quickly check the plugin auth wiring after auth, use this MCP tool:

- `cursor_auth_status` (reports whether `CURSOR_API_KEY` is available to the `cursor` MCP)

## Repeatable install (testing)

```sh
chmod +x scripts/reinstall-plugin.sh
npm run reinstall-plugin -- --smoke
```

With an already-configured key:

```sh
npm run reinstall-plugin -- --smoke
```

## Development

```sh
npm run check
npm run build
python3 /path/to/plugin-creator/scripts/validate_plugin.py plugins/agent-adaptor
```

The committed bundle lets the plugin run from this checkout. Rebuild it after changing `src/`.

## Security

The clipboard is read only after the user approves a native macOS confirmation dialog. The saved key file and its parent directory use owner-only permissions. `CURSOR_API_KEY` can override the saved value and is never accepted as a tool argument. Cursor's local agent runs with the permissions and sandbox policy configured for Cursor on your machine.

As of the initial release, `npm audit` reports an unfixed `undici` advisory inherited through the official Cursor SDK. Recheck the audit before production use and update the SDK when Cursor ships a patched dependency chain.
