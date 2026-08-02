import {
  Agent,
  AuthenticationError,
  CursorSdkError,
  type AgentOptions,
  type Run,
  type RunResult,
  type SDKAgent,
  type SDKMessage,
  type TokenUsage,
} from "@cursor/sdk";
import { randomUUID } from "node:crypto";

export type SessionMode = "agent" | "plan";
export type SessionStatus =
  | "starting"
  | "running"
  | "finished"
  | "auth_error"
  | "backend_error"
  | "cancelled"
  | "timed_out";
export type AuthState = "missing" | "configured" | "invalid" | "revoked";

export interface SessionActivity {
  sequence: number;
  at: string;
  type: "assistant" | "thinking" | "tool" | "status" | "task" | "usage";
  text?: string;
  tool?: string;
  status?: string;
  args?: unknown;
  result?: unknown;
}

export interface SessionSnapshot {
  session_id: string;
  auth_state: AuthState;
  auth_message: string;
  checkout: string;
  model: string;
  mode: SessionMode;
  prompt: string;
  status: SessionStatus;
  run_id?: string;
  activities: SessionActivity[];
  response?: string;
  error?: { kind: "auth" | "backend" | "cancelled" | "timeout"; message: string; code?: string };
  duration_ms?: number;
  usage?: TokenUsage;
  updated_at: string;
  can_follow_up: boolean;
  can_cancel: boolean;
  can_retry: boolean;
}

interface SessionRecord extends Omit<SessionSnapshot, "can_follow_up" | "can_cancel" | "can_retry"> {
  agentId?: string;
  agent?: SDKAgent;
  run?: Run;
  timer?: ReturnType<typeof setTimeout>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  timeoutMs: number;
  sequence: number;
  generation: number;
  runPrompt: string;
}

interface SessionDependencies {
  apiKey(): string;
  resolveCheckout(cwd: string): Promise<string>;
  createAgent(options: AgentOptions): Promise<SDKAgent>;
  resumeAgent(agentId: string, options: Partial<AgentOptions>): Promise<SDKAgent>;
}

const TERMINAL = new Set<SessionStatus>([
  "finished",
  "auth_error",
  "backend_error",
  "cancelled",
  "timed_out",
]);
const MAX_ACTIVITIES = 250;
const SESSION_TTL_MS = 30 * 60_000;

export class CursorSessionManager {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(private readonly dependencies: SessionDependencies) {}

  start(input: {
    cwd: string;
    prompt: string;
    model?: string;
    mode?: SessionMode;
    timeoutMs?: number;
  }): SessionSnapshot {
    const now = new Date().toISOString();
    const configuredKey = this.configuredKey();
    const session: SessionRecord = {
      session_id: randomUUID(),
      auth_state: "configured",
      auth_message: "Cursor API key is configured but has not yet been verified.",
      checkout: input.cwd,
      model: input.model ?? "auto",
      mode: input.mode ?? "agent",
      prompt: this.redact(input.prompt, configuredKey),
      status: "starting",
      activities: [],
      updated_at: now,
      timeoutMs: input.timeoutMs ?? 30 * 60_000,
      sequence: 0,
      generation: 1,
      runPrompt: input.prompt,
    };
    this.sessions.set(session.session_id, session);
    this.armTimeout(session);
    void this.launchNew(session, session.generation);
    return this.snapshot(session);
  }

  read(sessionId: string): SessionSnapshot {
    return this.snapshot(this.requireSession(sessionId));
  }

  followUp(sessionId: string, prompt: string, model = "auto"): SessionSnapshot {
    const session = this.requireSession(sessionId);
    if (session.status !== "finished" || !session.agentId) {
      throw new Error("Follow-up is available only after a successful Cursor run.");
    }
    this.resetForRun(session, prompt, model);
    void this.launchFollowUp(session, session.generation);
    return this.snapshot(session);
  }

  retry(sessionId: string): SessionSnapshot {
    const session = this.requireSession(sessionId);
    if (!TERMINAL.has(session.status) || session.status === "finished") {
      throw new Error("Retry is available only after an auth, backend, cancellation, or timeout failure.");
    }
    session.agentId = undefined;
    this.resetForRun(session, session.runPrompt, session.model);
    void this.launchNew(session, session.generation);
    return this.snapshot(session);
  }

  async cancel(sessionId: string): Promise<SessionSnapshot> {
    const session = this.requireSession(sessionId);
    if (session.status !== "starting" && session.status !== "running") {
      return this.snapshot(session);
    }
    session.status = "cancelled";
    session.error = { kind: "cancelled", message: "Cursor session cancelled by the user." };
    this.touch(session);
    this.addActivity(session, { type: "status", status: "CANCELLED", text: session.error.message });
    this.clearTimeout(session);
    try {
      await session.run?.cancel();
    } finally {
      this.closeAgent(session);
      this.scheduleCleanup(session);
    }
    return this.snapshot(session);
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      this.clearTimeout(session);
      if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
      this.closeAgent(session);
    }
  }

  private async launchNew(session: SessionRecord, generation: number): Promise<void> {
    let key: string | undefined;
    let agent: SDKAgent | undefined;
    try {
      session.checkout = await this.dependencies.resolveCheckout(session.checkout);
      if (generation !== session.generation || this.isStopped(session)) return;
      key = this.dependencies.apiKey();
      session.auth_state = "configured";
      agent = await this.dependencies.createAgent({
        apiKey: key,
        model: { id: session.model },
        mode: session.mode,
        local: { cwd: session.checkout },
      });
      if (generation !== session.generation || this.isStopped(session)) {
        agent.close();
        return;
      }
      session.agent = agent;
      session.agentId = agent.agentId;
      await this.sendAndObserve(session, agent, session.runPrompt, undefined, key, generation);
    } catch (error) {
      if (agent) this.closeAgent(session, agent);
      this.fail(session, error, key, generation);
    }
  }

  private async launchFollowUp(session: SessionRecord, generation: number): Promise<void> {
    let key: string | undefined;
    let agent: SDKAgent | undefined;
    try {
      key = this.dependencies.apiKey();
      agent = await this.dependencies.resumeAgent(session.agentId!, {
        apiKey: key,
        local: { cwd: session.checkout },
      });
      if (generation !== session.generation || this.isStopped(session)) {
        agent.close();
        return;
      }
      session.agent = agent;
      await this.sendAndObserve(
        session,
        agent,
        session.runPrompt,
        { model: { id: session.model }, mode: session.mode },
        key,
        generation,
      );
    } catch (error) {
      if (agent) this.closeAgent(session, agent);
      this.fail(session, error, key, generation);
    }
  }

  private async sendAndObserve(
    session: SessionRecord,
    agent: SDKAgent,
    prompt: string,
    options: Parameters<SDKAgent["send"]>[1],
    key: string,
    generation: number,
  ): Promise<void> {
    if (generation !== session.generation || this.isStopped(session)) {
      this.closeAgent(session, agent);
      return;
    }
    const run = await agent.send(prompt, options);
    if (generation !== session.generation || this.isStopped(session)) {
      await run.cancel();
      this.closeAgent(session, agent);
      return;
    }
    session.run = run;
    session.run_id = run.id;
    session.status = "running";
    session.auth_state = "configured";
    session.auth_message = "Cursor authentication accepted for this session.";
    this.touch(session);

    const removeStatusListener = run.onDidChangeStatus((status) => {
      if (generation === session.generation && !TERMINAL.has(session.status)) {
        this.addActivity(session, { type: "status", status: status.toUpperCase() });
      }
    });
    const resultPromise = run.wait();
    try {
      if (run.supports("stream")) {
        try {
          for await (const message of run.stream()) {
            if (generation !== session.generation) break;
            this.captureMessage(session, message, key);
          }
        } catch (error) {
          this.addActivity(session, {
            type: "status",
            status: "STREAM_ERROR",
            text: this.safeMessage(error, key),
          });
        }
      }
      this.complete(session, await resultPromise, key, generation);
    } finally {
      removeStatusListener();
      this.closeAgent(session, agent);
      if (generation === session.generation && TERMINAL.has(session.status)) this.scheduleCleanup(session);
    }
  }

  private captureMessage(session: SessionRecord, message: SDKMessage, key: string): void {
    switch (message.type) {
      case "assistant":
        for (const block of message.message.content) {
          if (block.type === "text") {
            this.addActivity(session, { type: "assistant", text: this.redact(block.text, key) });
          } else {
            this.addActivity(session, {
              type: "tool",
              tool: block.name,
              status: "requested",
              args: this.sanitize(block.input, key),
            });
          }
        }
        break;
      case "tool_call":
        this.addActivity(session, {
          type: "tool",
          tool: message.name,
          status: message.status,
          args: this.sanitize(message.args, key),
          result: this.sanitize(message.result, key),
        });
        break;
      case "thinking":
        this.addActivity(session, { type: "thinking", text: this.redact(message.text, key) });
        break;
      case "status":
        this.addActivity(session, {
          type: "status",
          status: message.status,
          text: message.message ? this.redact(message.message, key) : undefined,
        });
        if (message.status === "EXPIRED" && !TERMINAL.has(session.status)) {
          session.status = "timed_out";
          session.error = { kind: "timeout", message: "Cursor reported that the run expired." };
        }
        break;
      case "task":
        this.addActivity(session, {
          type: "task",
          status: message.status,
          text: message.text ? this.redact(message.text, key) : undefined,
        });
        break;
      case "usage":
        session.usage = message.usage;
        this.addActivity(session, { type: "usage", text: `${message.usage.totalTokens} tokens` });
        break;
    }
  }

  private complete(session: SessionRecord, result: RunResult, key: string, generation: number): void {
    if (generation !== session.generation) return;
    this.clearTimeout(session);
    if (session.status === "cancelled" || session.status === "timed_out") return;
    session.duration_ms = result.durationMs;
    session.usage = result.usage ?? session.usage;
    if (result.status === "finished") {
      session.status = "finished";
      session.response = result.result ? this.redact(result.result, key) : undefined;
      session.error = undefined;
    } else if (result.status === "cancelled") {
      session.status = "cancelled";
      session.error = { kind: "cancelled", message: "Cursor cancelled the run." };
    } else {
      session.status = "backend_error";
      session.error = {
        kind: "backend",
        message: this.redact(result.error?.message ?? "Cursor run failed.", key),
        code: result.error?.code,
      };
    }
    this.touch(session);
  }

  private fail(session: SessionRecord, error: unknown, key: string | undefined, generation: number): void {
    if (generation !== session.generation) return;
    if (session.status === "cancelled" || session.status === "timed_out") {
      this.closeAgent(session);
      return;
    }
    this.clearTimeout(session);
    const message = this.safeMessage(error, key);
    const code = error instanceof CursorSdkError ? error.code : undefined;
    const status = error instanceof CursorSdkError ? error.status : undefined;
    const missing = !key && /CURSOR_API_KEY is not configured/.test(message);
    const auth =
      missing ||
      error instanceof AuthenticationError ||
      status === 401 ||
      code === "unauthenticated" ||
      /unauth|api key/i.test(message);
    const revoked = auth && /revok/i.test(`${code ?? ""} ${message}`);
    const timedOut =
      !auth &&
      (status === 504 || /timeout|timed_out|deadline|expired/i.test(`${code ?? ""} ${message}`));
    if (auth) {
      session.status = "auth_error";
      session.auth_state = missing ? "missing" : revoked ? "revoked" : "invalid";
      session.auth_message = missing
        ? "No Cursor API key is configured."
        : revoked
          ? "The configured Cursor API key was revoked."
          : "Cursor rejected the configured API key.";
      session.error = { kind: "auth", message: session.auth_message, code };
    } else if (timedOut) {
      session.status = "timed_out";
      session.error = { kind: "timeout", message, code };
    } else {
      session.status = "backend_error";
      session.error = { kind: "backend", message, code };
    }
    this.addActivity(session, { type: "status", status: session.status.toUpperCase(), text: message });
    this.closeAgent(session);
    this.scheduleCleanup(session);
  }

  private async timeout(session: SessionRecord): Promise<void> {
    if (session.status !== "starting" && session.status !== "running") return;
    session.status = "timed_out";
    session.error = { kind: "timeout", message: `Cursor session timed out after ${session.timeoutMs} ms.` };
    this.touch(session);
    this.addActivity(session, { type: "status", status: "TIMED_OUT", text: session.error.message });
    try {
      await session.run?.cancel();
    } catch (error) {
      this.addActivity(session, {
        type: "status",
        status: "CANCEL_FAILED",
        text: this.safeMessage(error, this.configuredKey()),
      });
    } finally {
      this.closeAgent(session);
      this.scheduleCleanup(session);
    }
  }

  private resetForRun(session: SessionRecord, prompt: string, model: string): void {
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
    session.cleanupTimer = undefined;
    session.runPrompt = prompt;
    session.prompt = this.redact(prompt, this.configuredKey());
    session.model = model;
    session.status = "starting";
    session.run_id = undefined;
    session.response = undefined;
    session.error = undefined;
    session.duration_ms = undefined;
    session.usage = undefined;
    session.generation += 1;
    this.touch(session);
    this.addActivity(session, { type: "status", status: "STARTING", text: "Starting Cursor run." });
    this.armTimeout(session);
  }

  private addActivity(
    session: SessionRecord,
    activity: Omit<SessionActivity, "sequence" | "at">,
  ): void {
    session.activities.push({
      sequence: ++session.sequence,
      at: new Date().toISOString(),
      ...activity,
    });
    if (session.activities.length > MAX_ACTIVITIES) session.activities.shift();
    this.touch(session);
  }

  private snapshot(session: SessionRecord): SessionSnapshot {
    const terminalFailure = TERMINAL.has(session.status) && session.status !== "finished";
    return {
      session_id: session.session_id,
      auth_state: session.auth_state,
      auth_message: session.auth_message,
      checkout: session.checkout,
      model: session.model,
      mode: session.mode,
      prompt: this.redact(session.prompt, this.configuredKey()),
      status: session.status,
      run_id: session.run_id,
      activities: structuredClone(session.activities),
      response: session.response,
      error: session.error ? { ...session.error } : undefined,
      duration_ms: session.duration_ms,
      usage: session.usage ? { ...session.usage } : undefined,
      updated_at: session.updated_at,
      can_follow_up: session.status === "finished" && !!session.agentId,
      can_cancel: session.status === "starting" || session.status === "running",
      can_retry: terminalFailure,
    };
  }

  private requireSession(sessionId: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error("Cursor session was not found. It may have expired or the MCP server restarted.");
    }
    return session;
  }

  private armTimeout(session: SessionRecord): void {
    this.clearTimeout(session);
    session.timer = setTimeout(() => void this.timeout(session), session.timeoutMs);
    session.timer.unref();
  }

  private clearTimeout(session: SessionRecord): void {
    if (session.timer) clearTimeout(session.timer);
    session.timer = undefined;
  }

  private scheduleCleanup(session: SessionRecord): void {
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
    session.cleanupTimer = setTimeout(() => this.sessions.delete(session.session_id), SESSION_TTL_MS);
    session.cleanupTimer.unref();
  }

  private closeAgent(session: SessionRecord, agent = session.agent): void {
    agent?.close();
    if (session.agent === agent) {
      session.agent = undefined;
      session.run = undefined;
    }
  }

  private touch(session: SessionRecord): void {
    session.updated_at = new Date().toISOString();
  }

  private isStopped(session: SessionRecord): boolean {
    return session.status === "cancelled" || session.status === "timed_out";
  }

  private safeMessage(error: unknown, key?: string): string {
    return this.redact(error instanceof Error ? error.message : String(error), key);
  }

  private configuredKey(): string | undefined {
    try {
      return this.dependencies.apiKey();
    } catch {
      return undefined;
    }
  }

  private sanitize(value: unknown, key: string): unknown {
    if (typeof value === "string") return this.redact(value, key);
    if (Array.isArray(value)) return value.map((item) => this.sanitize(item, key));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [
          name,
          /api.?key|authorization|token|secret/i.test(name) ? "[REDACTED]" : this.sanitize(item, key),
        ]),
      );
    }
    return value;
  }

  private redact(value: string, key?: string): string {
    let redacted = key ? value.replaceAll(key, "[REDACTED]") : value;
    redacted = redacted.replace(/(?:CURSOR_API_KEY\s*[=:]\s*|Bearer\s+)[^\s"']+/gi, "$1[REDACTED]");
    return redacted;
  }
}

export const cursorSessionManager = (apiKey: () => string, resolveCheckout: (cwd: string) => Promise<string>) =>
  new CursorSessionManager({
    apiKey,
    resolveCheckout,
    createAgent: (options) => Agent.create(options),
    resumeAgent: (agentId, options) => Agent.resume(agentId, options),
  });
