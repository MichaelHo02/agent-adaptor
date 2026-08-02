import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "agent-adaptor-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: "node",
  args: ["./dist/server.mjs"],
  cwd: "plugins/agent-adaptor",
  env: { PATH: process.env.PATH ?? "" },
});

await client.connect(transport);
try {
  const names = (await client.listTools()).tools.map(({ name }) => name).sort();
  assert.deepEqual(names, ["cursor_follow_up", "cursor_run"]);
  const missingKey = await client.callTool({
    name: "cursor_run",
    arguments: { cwd: process.cwd(), prompt: "test" },
  });
  assert.equal(missingKey.isError, true);
  console.log(`MCP smoke test passed: ${names.join(", ")}`);
} finally {
  await client.close();
}
