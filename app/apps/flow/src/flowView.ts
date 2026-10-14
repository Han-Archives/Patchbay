import type { LangGraphPort, WaitRunResult } from "./langgraphAdapter.js";
import {
  checkpointFromState,
  currentNodesFromState,
  DEFAULT_LANGGRAPH_URL,
  normalizeLangGraph,
  ORIGINAL_STATE_KEYS,
  parseHistory,
  parseRun,
  pickStateText,
  SUMMARY_STATE_KEYS,
  taskErrorFromState,
  valuesFromState,
  type FlowAssistantView,
  type FlowRunView,
  type FlowThreadView,
  type FlowViewConnected,
  type FlowViewResponse,
} from "./langgraphContract.js";

export interface LoadFlowViewQuery {
  assistantId?: string;
  threadId?: string;
}

export type DelegateRunResult =
  | { ok: true; body: FlowViewResponse }
  | { ok: false; status: 400 | 503; error: string };

/**
 * Assemble the 흐름 탭 payload. Probe failure is `disconnected` (shell stays up).
 * `/api/graph` is not consulted — this is LangGraph only.
 */
export async function loadFlowView(
  port: LangGraphPort | undefined,
  query: LoadFlowViewQuery = {},
  fallbackUrl: string = DEFAULT_LANGGRAPH_URL,
): Promise<FlowViewResponse> {
  if (!port) {
    return { status: "disconnected", url: fallbackUrl };
  }

  const probed = await safeProbe(port);
  if (!probed) {
    return { status: "disconnected", url: port.url };
  }

  const warnings: string[] = [];
  const listedAssistants = await port.listAssistants();
  if (listedAssistants === null) warnings.push("그래프 목록을 읽지 못했습니다.");
  const assistants = listedAssistants ?? [];

  const selectedAssistant = pickAssistant(assistants, query.assistantId);
  let graph = { nodes: [] as FlowViewConnected["graph"]["nodes"], edges: [] as FlowViewConnected["graph"]["edges"] };
  if (selectedAssistant) {
    const rawGraph = await port.getGraph(selectedAssistant.id);
    if (rawGraph === null) warnings.push("그래프를 읽지 못했습니다.");
    else graph = normalizeLangGraph(rawGraph);
  }

  const listedThreads = await port.listThreads();
  if (listedThreads === null) warnings.push("스레드 목록을 읽지 못했습니다.");
  const threads = listedThreads ?? [];
  const selectedThread = pickThread(threads, query.threadId);

  let state: unknown = null;
  let runs: unknown[] = [];
  let history: unknown[] = [];
  if (selectedThread) {
    state = await port.getState(selectedThread.id);
    if (state === null) warnings.push("스레드 상태를 읽지 못했습니다.");
    const listed = await port.listRuns(selectedThread.id);
    if (listed === null) warnings.push("실행 목록을 읽지 못했습니다.");
    else runs = listed;
    const listedHistory = await port.listHistory(selectedThread.id);
    if (listedHistory === null) warnings.push("체크포인트를 읽지 못했습니다.");
    else history = listedHistory;
  }

  const values = valuesFromState(state);
  const latestRun = runs[0];
  const run = mergeRun(parseRun(latestRun), taskErrorFromState(state));

  let empty: FlowViewConnected["empty"] = "none";
  if (assistants.length === 0) empty = "no_assistants";
  else if (graph.nodes.length === 0) empty = "no_nodes";

  return {
    status: "connected",
    url: port.url,
    assistants,
    selectedAssistantId: selectedAssistant?.id ?? null,
    graph,
    threads,
    selectedThreadId: selectedThread?.id ?? null,
    currentNodes: currentNodesFromState(state),
    checkpoint: checkpointFromState(state),
    history: parseHistory(history),
    original: pickStateText(values, ORIGINAL_STATE_KEYS),
    summary: pickStateText(values, SUMMARY_STATE_KEYS),
    run,
    empty,
    warning: warnings.length > 0 ? warnings.join(" ") : null,
  };
}

export async function delegateFlowRun(
  port: LangGraphPort | undefined,
  payload: { assistantId?: unknown; threadId?: unknown; input?: unknown; checkpointId?: unknown },
  fallbackUrl: string = DEFAULT_LANGGRAPH_URL,
): Promise<DelegateRunResult> {
  if (!port || !(await safeProbe(port))) {
    return { ok: false, status: 503, error: "LangGraph 연결 안 됨" };
  }
  if (typeof payload.assistantId !== "string" || !payload.assistantId.trim()) {
    return { ok: false, status: 400, error: "assistantId is required." };
  }
  const assistantId = payload.assistantId.trim();
  let threadId = typeof payload.threadId === "string" && payload.threadId.trim() ? payload.threadId.trim() : "";

  if (!threadId) {
    const assistants = (await port.listAssistants()) ?? [];
    const assistant = assistants.find((item) => item.id === assistantId);
    const created = await port.createThread(assistant?.graphId ?? null);
    if (!created) {
      const body = await loadFlowView(port, { assistantId }, fallbackUrl);
      if (body.status === "connected") {
        return {
          ok: true,
          body: {
            ...body,
            run: { status: "error", error: "스레드를 만들지 못했습니다." },
            warning: joinWarning(body.warning, "스레드를 만들지 못했습니다."),
          },
        };
      }
      return { ok: true, body };
    }
    threadId = created;
  }

  const input = payload.input === undefined ? {} : payload.input;
  // Rewinding replays the graph from a checkpoint, so it carries no new
  // input -- the values are the ones already stored at that snapshot.
  const checkpointId =
    typeof payload.checkpointId === "string" && payload.checkpointId.trim()
      ? payload.checkpointId.trim()
      : undefined;
  const waited: WaitRunResult = await port.waitRun({
    threadId,
    assistantId,
    input: checkpointId ? null : input,
    checkpointId,
  });
  const body = await loadFlowView(port, { assistantId, threadId }, fallbackUrl);
  if (body.status !== "connected") return { ok: true, body };

  if (waited.status === "timeout") {
    return {
      ok: true,
      body: {
        ...body,
        selectedThreadId: threadId,
        run: { status: "running", error: body.run.error },
        warning: joinWarning(
          body.warning,
          "실행이 시간 제한을 넘었습니다. LangGraph에서 이어서 확인하세요.",
        ),
      },
    };
  }
  if (waited.status === "error") {
    return {
      ok: true,
      body: {
        ...body,
        selectedThreadId: threadId,
        run: { status: "error", error: waited.error },
        warning: joinWarning(body.warning, waited.error),
      },
    };
  }
  return { ok: true, body: { ...body, selectedThreadId: threadId } };
}

async function safeProbe(port: LangGraphPort): Promise<boolean> {
  try {
    return await port.probe();
  } catch {
    return false;
  }
}

function pickAssistant(assistants: FlowAssistantView[], requested?: string): FlowAssistantView | undefined {
  if (requested) {
    return assistants.find((item) => item.id === requested) ?? { id: requested, name: requested, graphId: null };
  }
  return assistants[0];
}

function pickThread(threads: FlowThreadView[], requested?: string): FlowThreadView | undefined {
  if (requested) {
    return threads.find((item) => item.id === requested) ?? { id: requested, updatedAt: null };
  }
  return threads[0];
}

function mergeRun(run: FlowRunView, taskError: string | null): FlowRunView {
  if (taskError && run.status !== "running") {
    return { status: "error", error: run.error ?? taskError };
  }
  if (taskError && !run.error) {
    return { ...run, error: taskError };
  }
  return run;
}

function joinWarning(existing: string | null, extra: string): string {
  return existing ? `${existing} ${extra}` : extra;
}
