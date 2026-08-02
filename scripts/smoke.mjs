import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const smokeHome = mkdtempSync(join(tmpdir(), "agent-adaptor-smoke-"));
const smokeBin = join(smokeHome, "bin");
mkdirSync(smokeBin);
writeFileSync(join(smokeBin, "pbpaste"), "#!/bin/sh\nprintf cursor_test_key_1234567890", { mode: 0o755 });
writeFileSync(join(smokeBin, "pbcopy"), "#!/bin/sh\ncat >/dev/null", { mode: 0o755 });
const client = new Client({ name: "cursor-mcp-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: "node",
  args: ["./dist/server.mjs"],
  cwd: "plugins/agent-adaptor",
  env: { CURSOR_API_KEY: "", HOME: smokeHome, PATH: `${smokeBin}:${process.env.PATH ?? ""}` },
});

await client.connect(transport);
try {
  assert.equal(client.getServerVersion()?.name, "cursor");
  const names = (await client.listTools()).tools.map(({ name }) => name).sort();
  assert.deepEqual(names, [
    "cursor_auth_status",
    "cursor_configure_from_clipboard",
    "cursor_follow_up",
    "cursor_run",
  ]);
  const authStatus = await client.callTool({ name: "cursor_auth_status", arguments: {} });
  assert.notEqual(authStatus.isError, true);
  const auth = JSON.parse(authStatus.content[0].text);
  assert.equal(auth.api_key_present, false);
  assert.equal(auth.api_key_url, "https://cursor.com/dashboard/api?section=user-keys#user-api-keys");
  assert.match(
    auth.action,
    process.platform === "darwin" ? /cursor_configure_from_clipboard/ : /Set CURSOR_API_KEY/,
  );
  assert.doesNotMatch(JSON.stringify(auth), /cursor-agent login|CURSOR_API_KEY_FILE/);
  const missingKey = await client.callTool({
    name: "cursor_run",
    arguments: { cwd: process.cwd(), prompt: "test" },
  });
  assert.equal(missingKey.isError, true);
  assert.match(
    missingKey.content[0].text,
    /https:\/\/cursor\.com\/dashboard\/api\?section=user-keys#user-api-keys/,
  );
  const configured = await client.callTool({
    name: "cursor_configure_from_clipboard",
    arguments: {},
  });
  if (process.platform === "darwin") {
    assert.notEqual(configured.isError, true);
    const envFile = join(smokeHome, ".config", "agent-adaptor", ".env");
    assert.equal(readFileSync(envFile, "utf8"), 'CURSOR_API_KEY="cursor_test_key_1234567890"\n');
    assert.equal(statSync(join(smokeHome, ".config", "agent-adaptor")).mode & 0o777, 0o700);
    assert.equal(statSync(envFile).mode & 0o777, 0o600);
    const configuredStatus = await client.callTool({ name: "cursor_auth_status", arguments: {} });
    assert.equal(JSON.parse(configuredStatus.content[0].text).api_key_present, true);
  } else {
    assert.equal(configured.isError, true);
    assert.match(configured.content[0].text, /supports macOS only/);
  }
  console.log(`MCP smoke test passed: ${names.join(", ")}`);
} finally {
  await client.close();
  rmSync(smokeHome, { recursive: true });
}
