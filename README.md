# Agent Adaptor

Agent Adaptor is a Codex plugin that delegates coding tasks to Cursor agents running against your current local checkout.

It uses Cursor's official TypeScript SDK and exposes two MCP tools:

- `cursor_run` starts a new Cursor agent.
- `cursor_follow_up` continues the same agent conversation.

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
codex plugin marketplace add "$PWD"
codex plugin add agent-adaptor@agent-adaptor
```

Start a new Codex task after installation so Codex discovers the plugin tools.

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
