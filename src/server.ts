import { Agent, type AgentOptions, type RunResult } from "@cursor/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { resolveCheckout } from "./checkout.js";

const server = new McpServer({ name: "agent-adaptor", version: "0.1.0" });
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

function apiKey(): string {
  const value = process.env.CURSOR_API_KEY;
  if (!value) throw new Error("CURSOR_API_KEY is not configured for Agent Adaptor");
  return value;
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

await server.connect(new StdioServerTransport());
