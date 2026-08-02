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

## Shared API-key configuration

Agent Adaptor and `cursor-agent` use the same `CURSOR_API_KEY` when it is inherited in their process environment:

```sh
export CURSOR_API_KEY="your-key"
```

`CURSOR_API_KEY_FILE` is also supported when the MCP process receives a path to a file containing the key. The plugin never accepts a key as a tool argument or returns it in tool output.

`cursor-agent login` is a separate browser session. It does not create, return, or configure `CURSOR_API_KEY` for the MCP. After changing the key in Codex plugin settings or its launch environment, start a new Codex task so the stdio MCP process inherits the new value.

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
