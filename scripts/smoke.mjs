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
const server = {
  command: "node",
  args: ["./dist/server.mjs"],
  cwd: "plugins/agent-adaptor",
  env: { CURSOR_API_KEY: "", HOME: smokeHome, PATH: `${smokeBin}:${process.env.PATH ?? ""}` },
};
process.on("exit", () => rmSync(smokeHome, { recursive: true }));

const client = new Client({ name: "cursor-mcp-smoke", version: "0.1.0" });
const transport = new StdioClientTransport(server);
let names;

await client.connect(transport);
try {
  assert.equal(client.getServerVersion()?.name, "cursor");
  names = (await client.listTools()).tools.map(({ name }) => name).sort();
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
    process.platform === "darwin" ? /cursor_configure_from_clipboard/ : /set CURSOR_API_KEY/,
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
  const envDirectory = join(smokeHome, ".config", "agent-adaptor");
  const envFile = join(envDirectory, ".env");
  if (process.platform === "darwin") {
    assert.notEqual(configured.isError, true);
    assert.equal(readFileSync(envFile, "utf8"), 'CURSOR_API_KEY="cursor_test_key_1234567890"\n');
    assert.equal(statSync(envDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(envFile).mode & 0o777, 0o600);
    const configuredStatus = await client.callTool({ name: "cursor_auth_status", arguments: {} });
    assert.equal(JSON.parse(configuredStatus.content[0].text).api_key_present, true);
  } else {
    assert.equal(configured.isError, true);
    assert.match(configured.content[0].text, /supports macOS only/);
    mkdirSync(envDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(envFile, 'CURSOR_API_KEY="cursor_test_key_1234567890"\n', { mode: 0o600 });
  }
} finally {
  await client.close();
}

const savedKeyClient = new Client({ name: "cursor-mcp-saved-key-smoke", version: "0.1.0" });
await savedKeyClient.connect(new StdioClientTransport(server));
try {
  const savedKeyStatus = await savedKeyClient.callTool({ name: "cursor_auth_status", arguments: {} });
  assert.equal(JSON.parse(savedKeyStatus.content[0].text).api_key_present, true);
} finally {
  await savedKeyClient.close();
}

console.log(`MCP smoke test passed: ${names.join(", ")}`);
