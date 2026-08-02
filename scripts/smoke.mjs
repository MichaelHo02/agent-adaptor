import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

assert.equal(process.platform, "darwin", "MCP smoke test currently supports macOS only.");
const pluginManifest = JSON.parse(
  readFileSync("plugins/agent-adaptor/.codex-plugin/plugin.json", "utf8"),
);
const appManifest = JSON.parse(readFileSync("plugins/agent-adaptor/.app.json", "utf8"));
assert.equal(pluginManifest.apps, "./.app.json", "MCP App plugins must declare app packaging.");
assert.deepEqual(appManifest, { apps: {} });
const smokeHome = mkdtempSync(join(tmpdir(), "agent-adaptor-smoke-"));
const server = {
  command: "node",
  args: ["./dist/server.mjs"],
  cwd: "plugins/agent-adaptor",
  env: { CURSOR_API_KEY: "", HOME: smokeHome, PATH: process.env.PATH ?? "" },
};
process.on("exit", () => rmSync(smokeHome, { recursive: true }));

const client = new Client({ name: "cursor-mcp-smoke", version: "0.1.0" });
const transport = new StdioClientTransport(server);
let names;

await client.connect(transport);
try {
  assert.equal(client.getServerVersion()?.name, "cursor");
  const tools = (await client.listTools()).tools;
  names = tools.map(({ name }) => name).sort();
  assert.deepEqual(names, [
    "cursor_auth_status",
    "cursor_configure_from_clipboard",
    "cursor_follow_up",
    "cursor_run",
    "cursor_session",
  ]);
  const sessionTool = tools.find(({ name }) => name === "cursor_session");
  assert.equal(sessionTool._meta.ui.resourceUri, "ui://agent-adaptor/cursor-session.html");
  assert.equal(sessionTool._meta["ui/resourceUri"], "ui://agent-adaptor/cursor-session.html");
  assert.deepEqual(sessionTool._meta.ui.visibility, ["model", "app"]);
  const resources = (await client.listResources()).resources;
  const panel = resources.find(({ uri }) => uri === "ui://agent-adaptor/cursor-session.html");
  assert.equal(panel.mimeType, "text/html;profile=mcp-app");
  const panelResource = await client.readResource({ uri: panel.uri });
  assert.equal(panelResource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(panelResource.contents[0].text, /Live Cursor session/);
  assert.match(panelResource.contents[0].text, /Agent mode may edit files or run commands/);
  assert.match(panelResource.contents[0].text, /ui\/initialize/);
  const authStatus = await client.callTool({ name: "cursor_auth_status", arguments: {} });
  assert.notEqual(authStatus.isError, true);
  const auth = JSON.parse(authStatus.content[0].text);
  assert.equal(auth.api_key_present, false);
  assert.equal(auth.api_key_url, "https://cursor.com/dashboard/api?section=user-keys#user-api-keys");
  assert.match(auth.action, /cursor_configure_from_clipboard/);
  assert.doesNotMatch(JSON.stringify(auth), /cursor-agent login|CURSOR_API_KEY_FILE/);
  const sessionStart = await client.callTool({
    name: "cursor_session",
    arguments: { action: "start", cwd: process.cwd(), prompt: "test", mode: "plan" },
  });
  assert.notEqual(sessionStart.isError, true);
  assert.equal(sessionStart.structuredContent.action, "start");
  assert.equal(sessionStart.structuredContent.session.mode, "plan");
  assert.equal("agent_id" in sessionStart.structuredContent.session, false);
  assert.match(sessionStart.content[0].text, /Plan mode is read-only planning/);
  let sessionSnapshot = sessionStart.structuredContent.session;
  for (let attempt = 0; attempt < 50 && sessionSnapshot.status === "starting"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const read = await client.callTool({
      name: "cursor_session",
      arguments: { action: "read", session_id: sessionSnapshot.session_id },
    });
    sessionSnapshot = read.structuredContent.session;
  }
  assert.equal(sessionSnapshot.status, "auth_error");
  assert.equal(sessionSnapshot.auth_state, "missing");
  assert.doesNotMatch(JSON.stringify(sessionSnapshot), /cursor_test_key/);
  const missingKey = await client.callTool({
    name: "cursor_run",
    arguments: { cwd: process.cwd(), prompt: "test" },
  });
  assert.equal(missingKey.isError, true);
  assert.match(
    missingKey.content[0].text,
    /https:\/\/cursor\.com\/dashboard\/api\?section=user-keys#user-api-keys/,
  );
  const envDirectory = join(smokeHome, ".config", "agent-adaptor");
  const envFile = join(envDirectory, ".env");
  mkdirSync(envDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(envFile, 'CURSOR_API_KEY="cursor_test_key_1234567890"\n', { mode: 0o600 });
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

console.log(`MCP smoke test passed: ${names.join(", ")} and live session UI resource`);
