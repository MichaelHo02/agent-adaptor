import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentOptions,
  Run,
  RunResult,
  RunStatus,
  SDKAgent,
  SDKMessage,
  SendOptions,
} from "@cursor/sdk";
import { AuthenticationError, NetworkError } from "@cursor/sdk";

import { CursorSessionManager, type SessionSnapshot } from "../src/cursor-session.js";

class FakeRun {
  readonly id: string;
  readonly agentId: string;
  status: RunStatus = "running";
  cancelled = false;
  private resolveResult!: (result: RunResult) => void;
  private readonly resultPromise = new Promise<RunResult>((resolve) => (this.resolveResult = resolve));
  private readonly listeners = new Set<(status: RunStatus) => void>();

  constructor(
    id: string,
    agentId: string,
    private readonly messages: SDKMessage[] = [],
    private readonly cancelError?: Error,
  ) {
    this.id = id;
    this.agentId = agentId;
  }

  supports(operation: string) { return operation === "stream" || operation === "wait" || operation === "cancel"; }
  unsupportedReason() { return undefined; }
  async *stream() { for (const message of this.messages) yield message; }
  wait() { return this.resultPromise; }
  async cancel() {
    if (this.status !== "running") return;
    this.cancelled = true;
    if (this.cancelError) throw this.cancelError;
    this.finish({ id: this.id, status: "cancelled" });
  }
  onDidChangeStatus(listener: (status: RunStatus) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  finish(result: RunResult) {
    this.status = result.status;
    for (const listener of this.listeners) listener(this.status);
    this.resolveResult(result);
  }
}

class FakeAgent {
  closed = false;
  sends: Array<{ prompt: string; options?: SendOptions }> = [];

  constructor(readonly agentId: string, private readonly runs: FakeRun[]) {}

  async send(prompt: string, options?: SendOptions) {
    this.sends.push({ prompt, options });
    const run = this.runs.shift();
    if (!run) throw new Error("No fake run queued");
    return run as unknown as Run;
  }
  close() { this.closed = true; }
}

async function waitFor(read: () => SessionSnapshot, status: SessionSnapshot["status"]) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = read();
    if (snapshot.status === status) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(`Session never reached ${status}`);
}

test("session streams activity and binds follow-up identity, checkout, and model auto", async () => {
  const firstRun = new FakeRun("run-1", "agent-1", [
    {
      type: "assistant",
      agent_id: "agent-1",
      run_id: "run-1",
      message: { role: "assistant", content: [{ type: "text", text: "Inspecting files" }] },
    },
    {
      type: "tool_call",
      agent_id: "agent-1",
      run_id: "run-1",
      call_id: "call-1",
      name: "read_file",
      status: "completed",
      args: { path: "README.md", apiKey: "must-not-appear" },
      result: "ok",
    },
  ]);
  const followUpRun = new FakeRun("run-2", "agent-1");
  const firstAgent = new FakeAgent("agent-1", [firstRun]);
  const resumedAgent = new FakeAgent("agent-1", [followUpRun]);
  let createOptions: AgentOptions | undefined;
  let resumeInput: { agentId: string; options: Partial<AgentOptions> } | undefined;
  const manager = new CursorSessionManager({
    apiKey: () => "cursor_secret_key_1234567890",
    resolveCheckout: async () => "/real/checkout",
    createAgent: async (options) => {
      createOptions = options;
      return firstAgent as unknown as SDKAgent;
    },
    resumeAgent: async (agentId, options) => {
      resumeInput = { agentId, options };
      return resumedAgent as unknown as SDKAgent;
    },
  });

  const rawPrompt = "Do work with cursor_secret_key_1234567890";
  const started = manager.start({ cwd: "/checkout", prompt: rawPrompt, mode: "plan" });
  assert.equal(started.status, "starting", "start returns before the run completes");
  assert.doesNotMatch(JSON.stringify(started), /cursor_secret_key/);
  await waitFor(() => manager.read(started.session_id), "running");
  assert.deepEqual(createOptions?.local, { cwd: "/real/checkout" });
  assert.equal(firstAgent.sends[0].prompt, rawPrompt);
  firstRun.finish({
    id: firstRun.id,
    status: "finished",
    result: "Done",
    usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 5 },
  });
  const finished = await waitFor(() => manager.read(started.session_id), "finished");
  assert.equal(finished.response, "Done");
  assert.equal(finished.activities.some(({ type, text }) => type === "assistant" && text === "Inspecting files"), true);
  assert.equal(finished.activities.some(({ tool }) => tool === "read_file"), true);
  assert.doesNotMatch(JSON.stringify(finished), /must-not-appear|cursor_secret_key/);
  assert.equal(firstAgent.closed, true);

  const rawFollowUp = "Check again with cursor_secret_key_1234567890";
  const following = manager.followUp(started.session_id, rawFollowUp);
  assert.equal(following.status, "starting");
  assert.doesNotMatch(JSON.stringify(following), /cursor_secret_key/);
  await waitFor(() => manager.read(started.session_id), "running");
  assert.deepEqual(resumeInput, {
    agentId: "agent-1",
    options: { apiKey: "cursor_secret_key_1234567890", local: { cwd: "/real/checkout" } },
  });
  assert.deepEqual(resumedAgent.sends[0], {
    prompt: rawFollowUp,
    options: { model: { id: "auto" }, mode: "plan" },
  });
  followUpRun.finish({ id: followUpRun.id, status: "finished", result: "Still done" });
  await waitFor(() => manager.read(started.session_id), "finished");
  manager.closeAll();
});

test("cancel and timeout cancel runs and close agent handles", async () => {
  const cancelRun = new FakeRun("run-cancel", "agent-cancel");
  const cancelAgent = new FakeAgent("agent-cancel", [cancelRun]);
  const timeoutRun = new FakeRun(
    "run-timeout",
    "agent-timeout",
    [],
    new Error("backend refused cancellation"),
  );
  const timeoutAgent = new FakeAgent("agent-timeout", [timeoutRun]);
  const agents = [cancelAgent, timeoutAgent];
  const manager = new CursorSessionManager({
    apiKey: () => "cursor_test_key_1234567890",
    resolveCheckout: async (cwd) => cwd,
    createAgent: async () => agents.shift() as unknown as SDKAgent,
    resumeAgent: async () => assert.fail("resume should not be called"),
  });

  const cancellable = manager.start({ cwd: "/checkout", prompt: "Wait" });
  await waitFor(() => manager.read(cancellable.session_id), "running");
  const cancelled = await manager.cancel(cancellable.session_id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelRun.cancelled, true);
  assert.equal(cancelAgent.closed, true);

  const expiring = manager.start({ cwd: "/checkout", prompt: "Wait", timeoutMs: 15 });
  const timedOut = await waitFor(() => manager.read(expiring.session_id), "timed_out");
  assert.equal(timedOut.error?.kind, "timeout");
  assert.equal(timeoutRun.cancelled, true);
  assert.equal(timeoutAgent.closed, true);
  assert.equal(timedOut.activities.some(({ status }) => status === "CANCEL_FAILED"), true);
  manager.closeAll();
});

test("missing auth is distinct and never starts Cursor", async () => {
  let created = false;
  const manager = new CursorSessionManager({
    apiKey: () => { throw new Error("CURSOR_API_KEY is not configured. Create one at https://example.test"); },
    resolveCheckout: async (cwd) => cwd,
    createAgent: async () => { created = true; return undefined as never; },
    resumeAgent: async () => undefined as never,
  });
  const started = manager.start({ cwd: "/checkout", prompt: "Work" });
  const failed = await waitFor(() => manager.read(started.session_id), "auth_error");
  assert.equal(failed.auth_state, "missing");
  assert.equal(created, false);
  manager.closeAll();
});

test("SDK auth revocation and backend timeout remain distinct", async () => {
  const managerFor = (error: Error) =>
    new CursorSessionManager({
      apiKey: () => "cursor_test_key_1234567890",
      resolveCheckout: async (cwd) => cwd,
      createAgent: async () => { throw error; },
      resumeAgent: async () => undefined as never,
    });

  const revokedManager = managerFor(
    new AuthenticationError("This API key was revoked", { code: "api_key_revoked", status: 401 }),
  );
  const revokedStart = revokedManager.start({ cwd: "/checkout", prompt: "Work" });
  const revoked = await waitFor(() => revokedManager.read(revokedStart.session_id), "auth_error");
  assert.equal(revoked.auth_state, "revoked");
  revokedManager.closeAll();

  const timeoutManager = managerFor(
    new NetworkError("Backend deadline exceeded", { code: "deadline_exceeded", status: 504 }),
  );
  const timeoutStart = timeoutManager.start({ cwd: "/checkout", prompt: "Work" });
  const timeout = await waitFor(() => timeoutManager.read(timeoutStart.session_id), "timed_out");
  assert.equal(timeout.error?.kind, "timeout");
  timeoutManager.closeAll();
});
