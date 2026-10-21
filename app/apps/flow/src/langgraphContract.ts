/** Client-safe LangGraph view types and freeze values (spec 4.1 / P5). No SDK, no fetch. */

export const DEFAULT_LANGGRAPH_URL = "http://127.0.0.1:2024";
export const LANGGRAPH_PROBE_TIMEOUT_MS = 800;
export const LANGGRAPH_RUN_TIMEOUT_MS = 20_000;
export const LANGGRAPH_LIST_LIMIT = 50;

/** Thread state keys tried in order for the 원문 panel. Missing → panel empty. */
export const ORIGINAL_STATE_KEYS = ["original", "source_text", "raw"] as const;

/** Thread state keys tried in order for the 정리본 panel. Missing → panel empty. */
export const SUMMARY_STATE_KEYS = ["summary", "digest", "compressed"] as const;

export type FlowRunStatus = "idle" | "running" | "error" | "success";

export interface FlowGraphNodeView {
  id: string;
  label: string;
}

export interface FlowGraphEdgeView {
  from: string;
  to: string;
}

export interface FlowGraphView {
  nodes: FlowGraphNodeView[];
  edges: FlowGraphEdgeView[];
}

export interface FlowAssistantView {
  id: string;
  name: string;
  graphId: string | null;
}

export interface FlowThreadView {
  id: string;
  updatedAt: string | null;
  /** `metadata.graph_id` — 스레드 목록은 그래프를 가리지 않아서, 어느 그래프의 스레드인지는 이것으로만 안다. */
  graphId?: string;
}

export interface FlowCheckpointView {
  id: string | null;
  ns: string | null;
}

/** Newest first from `POST /threads/{id}/history`; the view hands it over oldest first. */
export const LANGGRAPH_HISTORY_LIMIT = 20;

export interface FlowHistoryEntryView {
  id: string;
  /** Nodes queued at this checkpoint. Empty = the run had finished here. */
  next: string[];
  createdAt: string | null;
}

export interface FlowRunView {
  status: FlowRunStatus;
  error: string | null;
}

export interface FlowViewDisconnected {
  status: "disconnected";
  url: string;
}

export interface FlowViewConnected {
  status: "connected";
  url: string;
  assistants: FlowAssistantView[];
  selectedAssistantId: string | null;
  graph: FlowGraphView;
  threads: FlowThreadView[];
  selectedThreadId: string | null;
  currentNodes: string[];
  checkpoint: FlowCheckpointView | null;
  history: FlowHistoryEntryView[];
  original: string | null;
  summary: string | null;
  run: FlowRunView;
  empty: "none" | "no_assistants" | "no_nodes";
  warning: string | null;
}

export type FlowViewResponse = FlowViewDisconnected | FlowViewConnected;

export function isFlowViewConnected(body: FlowViewResponse): body is FlowViewConnected {
  return body.status === "connected";
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** `override` is already the env/CLI value. Empty/missing → spec default :2024. */
export function resolveLangGraphUrl(override?: string): string {
  const raw = override?.trim();
  return raw ? stripTrailingSlash(raw) : DEFAULT_LANGGRAPH_URL;
}

export function pickStateText(values: unknown, keys: readonly string[]): string | null {
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  const record = values as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export function listFromSearchBody(body: unknown, key: "assistants" | "threads"): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const nested = (body as Record<string, unknown>)[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function stringifyId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.length > 0) {
    const parts = value.map((part) => stringifyId(part)).filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(":") : null;
  }
  return null;
}

export function parseAssistant(raw: unknown): FlowAssistantView | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id =
    stringifyId(rec.assistant_id) ?? stringifyId(rec.assistantId) ?? stringifyId(rec.id);
  if (!id) return null;
  const name = typeof rec.name === "string" && rec.name.trim() ? rec.name : id;
  const graphId = stringifyId(rec.graph_id) ?? stringifyId(rec.graphId);
  return { id, name, graphId };
}

export function parseThread(raw: unknown): FlowThreadView | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = stringifyId(rec.thread_id) ?? stringifyId(rec.threadId) ?? stringifyId(rec.id);
  if (!id) return null;
  const updatedAt =
    typeof rec.updated_at === "string"
      ? rec.updated_at
      : typeof rec.created_at === "string"
        ? rec.created_at
        : null;
  const metadata = rec.metadata && typeof rec.metadata === "object" ? (rec.metadata as Record<string, unknown>) : {};
  const graphId = typeof metadata.graph_id === "string" && metadata.graph_id ? metadata.graph_id : undefined;
  return graphId ? { id, updatedAt, graphId } : { id, updatedAt };
}

/**
 * `POST /threads/{id}/history` -> the checkpoint rail, oldest first.
 *
 * Entries without a `checkpoint_id` are dropped: rewinding needs an id to
 * put in the run's `checkpoint`, so an entry you cannot return to is not a
 * stop on the rail.
 */
export function parseHistory(raw: unknown): FlowHistoryEntryView[] {
  if (!Array.isArray(raw)) return [];
  const entries: FlowHistoryEntryView[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const checkpoint = rec.checkpoint && typeof rec.checkpoint === "object"
      ? (rec.checkpoint as Record<string, unknown>)
      : undefined;
    const id = stringifyId(checkpoint?.checkpoint_id) ?? stringifyId(rec.checkpoint_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    entries.push({
      id,
      next: Array.isArray(rec.next) ? rec.next.filter((node): node is string => typeof node === "string") : [],
      createdAt: typeof rec.created_at === "string" ? rec.created_at : null,
    });
  }
  return entries.reverse();
}

export function normalizeLangGraph(raw: unknown): FlowGraphView {
  if (!raw || typeof raw !== "object") return { nodes: [], edges: [] };
  const obj = raw as Record<string, unknown>;
  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];

  const nodes: FlowGraphNodeView[] = [];
  const seen = new Set<string>();
  for (const node of rawNodes) {
    const parsed = parseGraphNode(node);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    nodes.push(parsed);
  }

  const edges: FlowGraphEdgeView[] = [];
  for (const edge of rawEdges) {
    const parsed = parseGraphEdge(edge);
    if (!parsed) continue;
    edges.push(parsed);
  }
  return { nodes, edges };
}

function parseGraphNode(raw: unknown): FlowGraphNodeView | null {
  if (typeof raw === "string" && raw) return { id: raw, label: raw };
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = stringifyId(rec.id);
  if (!id) return null;
  const data = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : undefined;
  const label =
    (typeof rec.name === "string" && rec.name.trim() && rec.name) ||
    (typeof data?.name === "string" && data.name.trim() && data.name) ||
    (typeof data?.id === "string" && data.id.trim() && data.id) ||
    id;
  return { id, label };
}

function parseGraphEdge(raw: unknown): FlowGraphEdgeView | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const from = stringifyId(rec.source) ?? stringifyId(rec.from);
  const to = stringifyId(rec.target) ?? stringifyId(rec.to);
  if (!from || !to) return null;
  return { from, to };
}

export function currentNodesFromState(state: unknown): string[] {
  if (!state || typeof state !== "object") return [];
  const next = (state as Record<string, unknown>).next;
  if (!Array.isArray(next)) return [];
  return next.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function checkpointFromState(state: unknown): FlowCheckpointView | null {
  if (!state || typeof state !== "object") return null;
  const rec = state as Record<string, unknown>;
  const nested = rec.checkpoint;
  if (nested && typeof nested === "object") {
    const cp = nested as Record<string, unknown>;
    const id = stringifyId(cp.checkpoint_id) ?? stringifyId(cp.id);
    const ns = typeof cp.checkpoint_ns === "string" && cp.checkpoint_ns ? cp.checkpoint_ns : null;
    if (!id && !ns) return null;
    return { id, ns };
  }
  const id = stringifyId(rec.checkpoint_id);
  return id ? { id, ns: null } : null;
}

export function valuesFromState(state: unknown): unknown {
  if (!state || typeof state !== "object") return null;
  return (state as Record<string, unknown>).values ?? null;
}

export function taskErrorFromState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const tasks = (state as Record<string, unknown>).tasks;
  if (!Array.isArray(tasks)) return null;
  for (const task of tasks) {
    if (!task || typeof task !== "object") continue;
    const error = (task as Record<string, unknown>).error;
    if (!error) continue;
    if (typeof error === "string" && error.trim()) return error;
    if (typeof error === "object" && error && "message" in error) {
      const message = (error as { message: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return null;
}

export function parseRun(raw: unknown): FlowRunView {
  if (!raw || typeof raw !== "object") return { status: "idle", error: null };
  const rec = raw as Record<string, unknown>;
  const rawStatus = typeof rec.status === "string" ? rec.status : "";
  let status: FlowRunStatus = "idle";
  if (rawStatus === "pending" || rawStatus === "running") status = "running";
  else if (rawStatus === "error" || rawStatus === "timeout") status = "error";
  else if (rawStatus === "success") status = "success";

  let error: string | null = null;
  if (typeof rec.error === "string" && rec.error.trim()) error = rec.error;
  else if (rec.error && typeof rec.error === "object" && "message" in rec.error) {
    const message = (rec.error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) error = message;
  }
  return { status, error };
}
