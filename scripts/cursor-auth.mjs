#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const child = spawnSync("cursor-agent", ["login"], {
  stdio: "inherit",
  timeout: 5 * 60_000,
});

if (child.error) {
  console.error("Unable to start cursor-agent login:", child.error.message);
  process.exit(1);
}

if (child.status !== 0) {
  const code = typeof child.status === "number" ? child.status : 1;
  process.exit(code);
}

console.log("\nLogin flow completed.");
console.log("Next: set CURSOR_API_KEY (or CURSOR_API_KEY_FILE) in the Codex MCP environment, then restart the plugin session.");
