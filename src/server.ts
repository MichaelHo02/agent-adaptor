import { Agent, type AgentOptions, type RunResult } from "@cursor/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { resolveCheckout } from "./checkout.js";

const server = new McpServer({ name: "agent-adaptor", version: "0.1.0" });
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

function apiKey(): string {
  const fromFile = process.env.CURSOR_API_KEY_FILE;
  if (fromFile) {
    const key = readFileSync(fromFile, "utf8").trim();
    if (key) return key;
  }

  const value = process.env.CURSOR_API_KEY;
  if (!value) throw new Error("CURSOR_API_KEY is not configured for Agent Adaptor");
  return value;
}

function safeCliStatus(): Record<string, string | number | boolean> {
  const child = spawnSync("cursor-agent", ["status"], {
    encoding: "utf8",
    timeout: 5_000,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (child.error) {
    return { ok: false, error: `cursor-agent command not available: ${child.error.message}` };
  }

  return {
    ok: child.status === 0,
    exitCode: child.status ?? -1,
    stdout: (child.stdout ?? "").trim() || "<empty>",
    stderr: (child.stderr ?? "").trim() || "<empty>",
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
    description:
      "Check whether CURSOR_API_KEY is configured for this MCP process and print cursor-agent login status.",
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
              auth_source: process.env.CURSOR_API_KEY_FILE
                ? `CURSOR_API_KEY_FILE (${process.env.CURSOR_API_KEY_FILE})`
                : process.env.CURSOR_API_KEY
                  ? "CURSOR_API_KEY"
                  : "not configured",
              env_key_present: !!process.env.CURSOR_API_KEY,
              key_file_present: !!process.env.CURSOR_API_KEY_FILE,
              cursor_cli_status: safeCliStatus(),
              next_step:
                process.env.CURSOR_API_KEY || process.env.CURSOR_API_KEY_FILE
                  ? "MCP can use existing credentials. If tools still fail, run `cursor-agent login` and restart Codex task."
                  : "Run `npm run cursor-auth` in this repo to launch browser login, then set CURSOR_API_KEY for the Codex MCP process.",
            },
            null,
            2,
          ),
        },
      ],
    })),
);

await server.connect(new StdioServerTransport());
