import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";

type Activity = {
  sequence: number;
  at: string;
  type: string;
  text?: string;
  tool?: string;
  status?: string;
  args?: unknown;
  result?: unknown;
};

type Snapshot = {
  session_id: string;
  auth_state: string;
  auth_message: string;
  checkout: string;
  model: string;
  mode: "agent" | "plan";
  prompt: string;
  status: string;
  run_id?: string;
  activities: Activity[];
  response?: string;
  error?: { kind: string; message: string; code?: string };
  duration_ms?: number;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  can_follow_up: boolean;
  can_cancel: boolean;
  can_retry: boolean;
};

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = new App({ name: "agent-adaptor-session", version: "0.1.0" }, {}, { autoResize: true });
let session: Snapshot | undefined;
let poll: ReturnType<typeof setTimeout> | undefined;
let actionPending = false;

function text(id: string, value: string) {
  element(id).textContent = value;
}

function toolResult(value: unknown): { structuredContent?: Record<string, unknown>; isError?: boolean; content?: unknown } {
  const candidate = value as { result?: unknown };
  return ((candidate?.result ?? candidate) as ReturnType<typeof toolResult>);
}

function acceptResult(value: unknown) {
  const result = toolResult(value);
  const next = result.structuredContent?.session;
  if (next && typeof next === "object") {
    session = next as Snapshot;
    render();
    schedulePoll();
  }
}

function render() {
  if (!session) return;
  text("status", session.status.replaceAll("_", " ").toUpperCase());
  text("mode", session.mode === "agent" ? "Agent mode" : "Plan mode");
  element("agent-warning").hidden = session.mode !== "agent";
  text("auth", `${session.auth_state}: ${session.auth_message}`);
  text("checkout", session.checkout);
  text("model", session.model);
  text("prompt", session.prompt);
  text("run", session.run_id ?? "Starting…");
  text(
    "usage",
    session.usage
      ? `${session.usage.totalTokens} total (${session.usage.inputTokens} input, ${session.usage.outputTokens} output)`
      : "—",
  );

  const activity = element("activity");
  activity.replaceChildren();
  if (!session.activities.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Waiting for activity…";
    activity.append(empty);
  }
  for (const event of session.activities) {
    const row = document.createElement("div");
    row.className = "event";
    const meta = document.createElement("div");
    meta.className = "event-meta";
    meta.textContent = [event.type, event.tool, event.status, new Date(event.at).toLocaleTimeString()]
      .filter(Boolean)
      .join(" · ");
    const body = document.createElement("pre");
    body.textContent = event.text ?? formatDetails(event);
    row.append(meta, body);
    activity.append(row);
  }
  activity.scrollTop = activity.scrollHeight;

  const hasResult = !!session.response || !!session.error;
  element("result-section").hidden = !hasResult;
  text("response", session.response ?? "");
  text(
    "error",
    session.error
      ? `${session.error.kind}: ${session.error.message}${session.error.code ? ` (${session.error.code})` : ""}`
      : "",
  );
  (element<HTMLButtonElement>("send")).disabled = actionPending || !session.can_follow_up;
  (element<HTMLButtonElement>("cancel")).disabled = actionPending || !session.can_cancel;
  (element<HTMLButtonElement>("retry")).disabled = actionPending || !session.can_retry;
}

function formatDetails(event: Activity): string {
  const details = [
    event.args === undefined ? undefined : `Arguments: ${JSON.stringify(event.args, null, 2)}`,
    event.result === undefined ? undefined : `Result: ${JSON.stringify(event.result, null, 2)}`,
  ].filter(Boolean);
  return details.join("\n") || "Status update";
}

async function call(arguments_: Record<string, unknown>) {
  actionPending = true;
  text("ui-error", "");
  render();
  try {
    const result = await app.callServerTool({ name: "cursor_session", arguments: arguments_ });
    if (result.isError) throw new Error("Cursor session action failed.");
    acceptResult(result);
  } catch (error) {
    text("ui-error", error instanceof Error ? error.message : String(error));
  } finally {
    actionPending = false;
    render();
  }
}

function schedulePoll() {
  if (poll) clearTimeout(poll);
  if (!session || (session.status !== "starting" && session.status !== "running")) return;
  poll = setTimeout(() => void call({ action: "read", session_id: session!.session_id }), 1_000);
}

app.ontoolresult = acceptResult;
app.ontoolcancelled = () => text("ui-error", "The host cancelled the session tool call.");

element("send").addEventListener("click", () => {
  const input = element<HTMLTextAreaElement>("follow-up");
  const prompt = input.value.trim();
  if (!session || !prompt) return;
  input.value = "";
  void call({ action: "follow_up", session_id: session.session_id, prompt, model: "auto" });
});
element("cancel").addEventListener("click", () => {
  if (session) void call({ action: "cancel", session_id: session.session_id });
});
element("retry").addEventListener("click", () => {
  if (session) void call({ action: "retry", session_id: session.session_id });
});

void app.connect().catch((error) => {
  text("ui-error", `Could not connect to the MCP host: ${error instanceof Error ? error.message : String(error)}`);
});
