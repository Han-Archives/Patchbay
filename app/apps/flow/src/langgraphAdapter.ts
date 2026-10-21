import {
  LANGGRAPH_HISTORY_LIMIT,
  LANGGRAPH_LIST_LIMIT,
  LANGGRAPH_PROBE_TIMEOUT_MS,
  LANGGRAPH_RUN_TIMEOUT_MS,
  listFromSearchBody,
  parseAssistant,
  parseThread,
  resolveLangGraphUrl,
  type FlowAssistantView,
  type FlowThreadView,
} from "./langgraphContract.js";

export type WaitRunResult =
  | { status: "ok"; body: unknown }
  | { status: "error"; error: string }
  | { status: "timeout" };

export interface LangGraphPort {
  readonly url: string;
  probe(): Promise<boolean>;
  listAssistants(): Promise<FlowAssistantView[] | null>;
  getGraph(assistantId: string): Promise<unknown | null>;
  listThreads(): Promise<FlowThreadView[] | null>;
  getState(threadId: string): Promise<unknown | null>;
  listRuns(threadId: string): Promise<unknown[] | null>;
  listHistory(threadId: string): Promise<unknown[] | null>;
  createThread(graphId?: string | null): Promise<string | null>;
  waitRun(input: {
    threadId: string;
    assistantId: string;
    input: unknown;
    /** Fork from this checkpoint instead of the thread's tip. */
    checkpointId?: string;
    /**
     * Resume a node that stopped on `interrupt()` -- LangGraph's `Command(resume=…)`.
     * Sent instead of `input`; the value becomes `interrupt()`'s return value.
     */
    command?: { resume: unknown };
    /** Stop right after these nodes -- with `checkpointId`, the whole of 「이 노드만 실행」. */
    interruptAfter?: string[];
  }): Promise<WaitRunResult>;
}

export interface LangGraphHttpOptions {
  url?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  runTimeoutMs?: number;
}

interface JsonResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

export function createLangGraphHttpPort(options: LangGraphHttpOptions = {}): LangGraphPort {
  const url = resolveLangGraphUrl(options.url);
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? LANGGRAPH_PROBE_TIMEOUT_MS;
  const runTimeoutMs = options.runTimeoutMs ?? LANGGRAPH_RUN_TIMEOUT_MS;

  const request = (method: string, path: string, body: unknown | undefined, ms: number) =>
    requestJson({ fetchImpl, url: `${url}${path}`, method, body, timeoutMs: ms });

  return {
    url,
    async probe() {
      const res = await request("POST", "/assistants/search", { limit: 1 }, timeoutMs);
      return res.ok;
    },
    async listAssistants() {
      const res = await request("POST", "/assistants/search", { limit: LANGGRAPH_LIST_LIMIT }, timeoutMs);
      if (!res.ok) return null;
      const parsed: FlowAssistantView[] = [];
      for (const item of listFromSearchBody(res.body, "assistants")) {
        const assistant = parseAssistant(item);
        if (assistant) parsed.push(assistant);
      }
      return parsed;
    },
    async getGraph(assistantId) {
      const res = await request("GET", `/assistants/${encodeURIComponent(assistantId)}/graph`, undefined, timeoutMs);
      if (!res.ok) return null;
      return res.body;
    },
    async listThreads() {
      const res = await request(
        "POST",
        "/threads/search",
        { limit: LANGGRAPH_LIST_LIMIT, sort_by: "updated_at", sort_order: "desc" },
        timeoutMs,
      );
      if (!res.ok) return null;
      const parsed: FlowThreadView[] = [];
      for (const item of listFromSearchBody(res.body, "threads")) {
        const thread = parseThread(item);
        if (thread) parsed.push(thread);
      }
      return parsed;
    },
    async getState(threadId) {
      const res = await request("GET", `/threads/${encodeURIComponent(threadId)}/state`, undefined, timeoutMs);
      if (!res.ok) return null;
      return res.body;
    },
    async listRuns(threadId) {
      const res = await request(
        "GET",
        `/threads/${encodeURIComponent(threadId)}/runs?limit=10`,
        undefined,
        timeoutMs,
      );
      if (!res.ok) return null;
      return Array.isArray(res.body) ? res.body : [];
    },
    async listHistory(threadId) {
      const res = await request(
        "POST",
        `/threads/${encodeURIComponent(threadId)}/history`,
        { limit: LANGGRAPH_HISTORY_LIMIT },
        timeoutMs,
      );
      if (!res.ok) return null;
      return Array.isArray(res.body) ? res.body : [];
    },
    async createThread(graphId) {
      const payload: Record<string, unknown> = {};
      if (graphId) payload.metadata = { graph_id: graphId };
      const res = await request("POST", "/threads", payload, timeoutMs);
      if (!res.ok || !res.body || typeof res.body !== "object") return null;
      const rec = res.body as Record<string, unknown>;
      const threadId = typeof rec.thread_id === "string" ? rec.thread_id : null;
      return threadId;
    },
    async waitRun({ threadId, assistantId, input, checkpointId, command, interruptAfter }) {
      const path = `/threads/${encodeURIComponent(threadId)}/runs/wait`;
      // `checkpoint` makes LangGraph fork the thread from that snapshot
      // instead of appending to its tip -- the whole of "여기서 다시".
      const payload: Record<string, unknown> = command
        ? { assistant_id: assistantId, command }
        : { assistant_id: assistantId, input };
      if (checkpointId) payload.checkpoint = { checkpoint_id: checkpointId };
      if (interruptAfter?.length) payload.interrupt_after = interruptAfter;
      const waited = await request("POST", path, payload, runTimeoutMs);
      if (waited.status === 0) return { status: "timeout" };
      if (waited.status === 404) {
        const created = await request(
          "POST",
          `/threads/${encodeURIComponent(threadId)}/runs`,
          payload,
          timeoutMs,
        );
        if (!created.ok) {
          return { status: "error", error: errorMessage(created.body) ?? `HTTP ${created.status}` };
        }
        return { status: "ok", body: created.body };
      }
      if (!waited.ok) {
        return { status: "error", error: errorMessage(waited.body) ?? `HTTP ${waited.status}` };
      }
      const waitError = errorMessage(waited.body);
      if (waitError) return { status: "error", error: waitError };
      return { status: "ok", body: waited.body };
    },
  };
}

function errorMessage(body: unknown): string | null {
  if (!body) return null;
  if (typeof body === "string" && body.trim()) return body;
  if (typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  const wrapped = rec.__error__;
  if (wrapped && typeof wrapped === "object") {
    const err = wrapped as Record<string, unknown>;
    const message = typeof err.message === "string" ? err.message : null;
    const kind = typeof err.error === "string" ? err.error : null;
    if (kind && message) return `${kind}: ${message}`;
    return message ?? kind;
  }
  if (typeof rec.detail === "string" && rec.detail.trim()) return rec.detail;
  if (typeof rec.error === "string" && rec.error.trim()) return rec.error;
  return null;
}

async function requestJson(options: {
  fetchImpl: typeof fetch;
  url: string;
  method: string;
  body: unknown | undefined;
  timeoutMs: number;
}): Promise<JsonResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  try {
    const res = await options.fetchImpl(options.url, {
      method: options.method,
      signal: ctrl.signal,
      headers: {
        accept: "application/json",
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}
