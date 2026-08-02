---
name: use-agent-adaptor
description: Delegate a coding task from Codex to a local Cursor agent working in the current checkout, then continue that Cursor conversation when needed.
---

# Use Agent Adaptor

1. Resolve the exact current Git checkout root before calling a tool.
2. Prefer `cursor_session` with `action: "start"` when a live panel is useful; discover/load it first if the host uses lazy tool loading, then invoke it directly so the host can render its MCP App. Never proxy `cursor_session` through a shell or generic executor. Use `cursor_run` for text-only/model workflows.
3. Treat Cursor as able to edit files and run commands in that checkout.
4. For a panel session, reuse its session ID with `read`, `follow_up`, `cancel`, or `retry`; the server binds agent identity and checkout. For text-only use, report Cursor's response and agent ID, then use `cursor_follow_up` with the same checkout and agent ID.
5. Never send secrets in prompts. If authentication is missing, ask the user to copy a Cursor User API Key, call `cursor_configure_from_clipboard`, and approve the native macOS confirmation dialog; never request the key in chat.
