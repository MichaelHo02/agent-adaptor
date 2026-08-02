import { Agent, type AgentOptions, type RunResult } from "@cursor/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

import { resolveCheckout } from "./checkout.js";

const CURSOR_API_KEYS_URL = "https://cursor.com/dashboard/api?section=user-keys#user-api-keys";
const CURSOR_ENV_FILE = join(homedir(), ".config", "agent-adaptor", ".env");
const server = new McpServer({ name: "cursor", version: "0.1.0" });
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

const authReadOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const authWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

function apiKey(): string {
  const value = process.env.CURSOR_API_KEY;
  if (!value) {
    throw new Error(`CURSOR_API_KEY is not configured. Create one at ${CURSOR_API_KEYS_URL}`);
  }
  return value;
}

try {
  process.loadEnvFile(CURSOR_ENV_FILE);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

function configureFromClipboard() {
  if (process.platform !== "darwin") {
    throw new Error("Clipboard setup currently supports macOS only. Set CURSOR_API_KEY instead.");
  }

  const clipboard = spawnSync("pbpaste", { encoding: "utf8", timeout: 5_000 });
  if (clipboard.error || clipboard.status !== 0) {
    throw new Error(`Could not read the clipboard: ${clipboard.error?.message ?? "pbpaste failed"}`);
  }

  const key = clipboard.stdout.trim();
  if (!/^[A-Za-z0-9._~+/=-]{20,}$/.test(key)) {
    throw new Error("Clipboard does not contain a valid single-line Cursor API key.");
  }

  const directory = dirname(CURSOR_ENV_FILE);
  const temporaryFile = `${CURSOR_ENV_FILE}.${process.pid}.tmp`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  try {
    writeFileSync(temporaryFile, `CURSOR_API_KEY="${key}"\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporaryFile, CURSOR_ENV_FILE);
    chmodSync(CURSOR_ENV_FILE, 0o600);
  } finally {
    rmSync(temporaryFile, { force: true });
  }

  process.env.CURSOR_API_KEY = key;
  const cleared = spawnSync("pbcopy", { input: "", encoding: "utf8", timeout: 5_000 });
  return {
    configured: true,
    location: CURSOR_ENV_FILE,
    clipboard_cleared: !cleared.error && cleared.status === 0,
    action: "Cursor is configured for this and future Codex tasks.",
  };
}

function response(result: RunResult, agentId: string) {
  const payload = {
    agent_id: agentId,
    run_id: result.id,
    status: result.status,
    response: result.result,
    error: result.error,
    duration_ms: result.durationMs,
    usage: result.usage,
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

async function failure<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }
}

server.registerTool(
  "cursor_configure_from_clipboard",
  {
    title: "Configure Cursor from clipboard",
    description:
      "On macOS, securely save a copied Cursor User API Key without exposing it in prompts or tool output.",
    inputSchema: {},
    annotations: authWriteAnnotations,
  },
  () => failure(async () => ({
    content: [{ type: "text" as const, text: JSON.stringify(configureFromClipboard(), null, 2) }],
  })),
);

server.registerTool(
  "cursor_run",
  {
    title: "Run Cursor agent",
    description:
      "Run a new local Cursor agent against an exact checkout. The agent can inspect, edit, and execute code in that directory.",
    inputSchema: {
      cwd: z.string().describe("Absolute path to the current checkout"),
      prompt: z.string().min(1).describe("Task for Cursor"),
      model: z.string().min(1).default("auto").describe("Cursor model ID"),
      mode: z.enum(["agent", "plan"]).default("agent"),
    },
    annotations: writeAnnotations,
  },
  ({ cwd, prompt, model, mode }) =>
    failure(async () => {
      const checkout = await resolveCheckout(cwd);
      const agent = await Agent.create({
        apiKey: apiKey(),
        model: { id: model },
        mode,
        local: { cwd: checkout },
      });
      try {
        return response(await (await agent.send(prompt)).wait(), agent.agentId);
      } finally {
        agent.close();
      }
    }),
);

server.registerTool(
  "cursor_follow_up",
  {
    title: "Follow up with Cursor agent",
    description: "Continue a local Cursor agent conversation in the same checkout.",
    inputSchema: {
      agent_id: z.string().min(1).describe("Agent ID returned by cursor_run"),
      cwd: z.string().describe("Absolute path to the same checkout"),
      prompt: z.string().min(1).describe("Follow-up instruction for Cursor"),
      model: z.string().min(1).optional().describe("Optional Cursor model override"),
    },
    annotations: writeAnnotations,
  },
  ({ agent_id, cwd, prompt, model }) =>
    failure(async () => {
      const checkout = await resolveCheckout(cwd);
      const options: Partial<AgentOptions> = { apiKey: apiKey(), local: { cwd: checkout } };
      const agent = await Agent.resume(agent_id, options);
      try {
        const run = await agent.send(prompt, model ? { model: { id: model } } : undefined);
        return response(await run.wait(), agent.agentId);
      } finally {
        agent.close();
      }
  }),
);

server.registerTool(
  "cursor_auth_status",
  {
    title: "Check Cursor auth status",
    description: "Check whether CURSOR_API_KEY is configured for the Cursor MCP process.",
    inputSchema: {},
    annotations: authReadOnlyAnnotations,
  },
  () =>
    failure(async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              api_key_present: !!process.env.CURSOR_API_KEY,
              api_key_url: CURSOR_API_KEYS_URL,
              action: process.env.CURSOR_API_KEY
                ? "CURSOR_API_KEY is configured."
                : process.platform === "darwin"
                  ? "Copy a Cursor User API Key, then call cursor_configure_from_clipboard."
                  : "Create a Cursor User API Key, set CURSOR_API_KEY, then restart the MCP server.",
            },
            null,
            2,
          ),
        },
      ],
    })),
);

await server.connect(new StdioServerTransport());
