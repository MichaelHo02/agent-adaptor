# Agent Adaptor

Agent Adaptor is a Codex plugin that delegates coding tasks to Cursor agents running against your current local checkout.

It uses Cursor's official TypeScript SDK and exposes three MCP tools:

- `cursor_run` starts a new Cursor agent.
- `cursor_follow_up` continues the same agent conversation.
- `cursor_auth_status` checks MCP auth wiring and `cursor-agent status` output.

Cursor can read, edit, and run code in the checkout you pass. Review its changes as you would any other coding agent.

## Requirements

- Node.js 22.13 or newer
- A Cursor plan with SDK access
- A Cursor API key from the Cursor integrations dashboard

## Local setup

```sh
git clone https://github.com/MichaelHo02/agent-adaptor.git
cd agent-adaptor
npm install
npm run check
npm run build
export CURSOR_API_KEY="your-key"
```

## First-time auth flow

If you prefer browser auth first, run:

```sh
npm run cursor-auth
```

This opens Cursor's login flow in a browser. After success, copy your Cursor API key from the integrations dashboard and set it in the MCP process environment (or provide `CURSOR_API_KEY_FILE`).
Cursor's website login does not currently emit the token back to this plugin process automatically.

To quickly check the plugin auth wiring after auth, use this MCP tool:

- `cursor_auth_status` (reports whether `CURSOR_API_KEY` is available to MCP and `cursor-agent status` output)

Then continue:

```sh
export CURSOR_API_KEY="your-key"
codex plugin marketplace add "$PWD"
codex plugin add agent-adaptor@agent-adaptor
```

Start a new Codex task after installation so Codex discovers the plugin tools.

## Repeatable install (testing)

```sh
chmod +x scripts/reinstall-plugin.sh
npm run reinstall-plugin -- --smoke
```

With browser auth flow in the same run:

```sh
npm run reinstall-plugin -- --auth --smoke
```

With an already-exported key:

```sh
export CURSOR_API_KEY="your-key"
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

`CURSOR_API_KEY` is inherited by the MCP process and is never accepted as a tool argument. Cursor's local agent runs with the permissions and sandbox policy configured for Cursor on your machine.

As of the initial release, `npm audit` reports an unfixed `undici` advisory inherited through the official Cursor SDK. Recheck the audit before production use and update the SDK when Cursor ships a patched dependency chain.
