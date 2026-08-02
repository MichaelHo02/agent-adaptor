---
name: use-agent-adaptor
description: Delegate a coding task from Codex to a local Cursor agent working in the current checkout, then continue that Cursor conversation when needed.
---

# Use Agent Adaptor

1. Resolve the exact current Git checkout root before calling a tool.
2. Call `cursor_run` with that absolute path and the user's task.
3. Treat Cursor as able to edit files and run commands in that checkout.
4. Report Cursor's returned response and agent ID. Use `cursor_follow_up` with the same checkout and agent ID for later instructions.
5. Never send secrets in prompts. Authentication comes only from `CURSOR_API_KEY`.
