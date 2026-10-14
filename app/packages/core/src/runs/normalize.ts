import {
  parseRunRecord,
  documentCallSchema,
  modelCallSchema,
  runUsageSchema,
  toolCallSchema,
  type DocumentCall,
  type ModelCall,
  type RunRecord,
  type RunStatus,
  type ToolCall,
  type RunUsage,
} from "./types.js";

/**
 * 공급자 → §5.2 정규화. **Core does this, not the adapter** (명세 §5.5): pulling
 * bytes differs per provider, but the shape that comes out is one.
 *
 * The hard rule this module exists to keep: 「빈 배열은 값이다. 필드를 빼는 것과
 * `[]`는 다르다」(§5.2). LangGraph's run object reports *that* a run happened and
 * how it ended; it does not report which models, tools or documents the graph
 * called. So this normalizer will **not** hand back `toolCalls: []` for a
 * provider that does not report tool calls -- that would turn 「기록이 없다」into
 * 「툴을 안 불렀다」 and make 5.3's comparison silently pass.
 *
 * Instead it names the gap. 기획서 5.2 delegates trace collection to an external
 * observability tool, and a gap report is what that delegation looks like from
 * in here: either the graph reports its own calls (`patchbayCalls` below) or the
 * record cannot be completed, and Patchbay says which.
 */

/**
 * The key a graph writes its own call log under, in thread state values.
 *
 * The generated code is already where runtime enforcement lives (§4.3), so it is
 * also the honest place for runtime *reporting*: the node knows which model it
 * called and under which capability, and no observer outside it does.
 */
export const CALL_LOG_STATE_KEY = "patchbayCalls";

/** Which of the thirteen a provider left unfilled. */
export type RunGap = "modelCalls" | "toolCalls" | "documentCalls" | "usage" | "nodeId" | "irVersion" | "graphId";

export type NormalizeResult =
  | { ok: true; record: RunRecord; gaps: [] }
  | { ok: false; gaps: RunGap[]; reason: string };

export interface LangGraphRunInput {
  /** One entry of `GET /threads/{id}/runs`. */
  run: unknown;
  /** `GET /threads/{id}/state` — where `patchbayCalls` is looked for. */
  state?: unknown;
  /** Which design to compare against. The provider does not know it; the caller does. */
  irVersion: number;
  /** Falls back to the run's `metadata.graph_id` / `assistant_id`. */
  graphId?: string;
}

const LANGGRAPH_STATUS: Record<string, RunStatus> = {
  success: "success",
  error: "error",
  timeout: "timeout",
  // LangGraph의 interrupted는 사람이 끊은 것이다 — 모델이 거절한 refused와 다르다.
  interrupted: "error",
};

/**
 * One LangGraph run → one record, as far as LangGraph can take it.
 *
 * `refused` is never read off the run status: LangGraph has no such status, and
 * a refusal is a fact about a *model call*. It is derived only when the graph's
 * own call log reports a refused model call on a run that did not succeed.
 */
export function normalizeLangGraphRun(input: LangGraphRunInput): NormalizeResult {
  const run = asRecord(input.run);
  if (!run) return { ok: false, gaps: [], reason: "실행 기록: 공급자 응답이 객체가 아니다." };

  const runId = firstString(run, ["run_id", "runId", "id"]);
  if (!runId) return { ok: false, gaps: [], reason: "실행 기록: 공급자 응답에 run_id 가 없다." };

  const rawStatus = firstString(run, ["status"]) ?? "";
  const status = LANGGRAPH_STATUS[rawStatus];
  if (!status) {
    return {
      ok: false,
      gaps: [],
      reason:
        `실행 기록: "${runId}" 의 상태가 "${rawStatus}" 다 — 끝나지 않은 실행은 수집하지 않는다 ` +
        `(수집 가능: ${Object.keys(LANGGRAPH_STATUS).join(" · ")}).`,
    };
  }

  const startedAt = firstString(run, ["created_at", "createdAt"]);
  const endedAt = firstString(run, ["updated_at", "updatedAt"]) ?? startedAt;
  if (!startedAt || !endedAt) {
    return { ok: false, gaps: [], reason: `실행 기록: "${runId}" 에 created_at/updated_at 이 없다.` };
  }

  const metadata = asRecord(run.metadata) ?? {};
  const graphId =
    input.graphId ??
    firstString(metadata, ["graph_id", "graphId"]) ??
    firstString(run, ["assistant_id", "assistantId"]);

  const log = readCallLog(input.state);
  const gaps: RunGap[] = [];
  if (!graphId) gaps.push("graphId");
  if (!log.modelCalls) gaps.push("modelCalls");
  if (!log.toolCalls) gaps.push("toolCalls");
  if (!log.documentCalls) gaps.push("documentCalls");
  if (!log.usage) gaps.push("usage");

  if (gaps.length > 0) {
    return {
      ok: false,
      gaps,
      reason:
        `실행 기록: "${runId}" 를 완성할 수 없다 — 이 공급자가 보고하지 않는 칸 ${gaps.join(" · ")}. ` +
        `그래프가 state 의 "${CALL_LOG_STATE_KEY}" 에 자기 호출 기록을 쓰면 채워진다. ` +
        `빈 배열로 채우지 않는다 — 「안 불렀다」와 「기록이 없다」는 다른 사실이다.`,
    };
  }

  const modelCalls = log.modelCalls!;
  const toolCalls = log.toolCalls!;
  const documentCalls = log.documentCalls!;

  /** A refusal is a model-call fact, not a run-status one. */
  const refused =
    status !== "success" && modelCalls.some((call) => call.status === "refused") ? ("refused" as const) : null;

  const nodeId =
    firstString(metadata, ["node", "nodeId"]) ??
    lastNodeFromLog(modelCalls, toolCalls, documentCalls) ??
    null;

  const errorMessage = firstString(run, ["error"]) ?? errorFromMetadata(metadata);
  const finalStatus = refused ?? status;
  const record = {
    runId,
    graphId: graphId!,
    irVersion: input.irVersion,
    status: finalStatus,
    nodeId,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    modelCalls,
    toolCalls,
    documentCalls,
    usage: log.usage!,
    error:
      finalStatus === "success" || nodeId === null
        ? null
        : {
            kind:
              finalStatus === "timeout"
                ? ("timeout" as const)
                : finalStatus === "refused"
                  ? ("refusal" as const)
                  : ("runtime" as const),
            message: errorMessage ?? `실행이 ${finalStatus} 로 끝났다`,
            nodeId,
          },
  };

  // 자기 스키마로 한 번 더 통과시킨다 — 정규화가 만든 것도 §5.2를 지켜야 한다.
  const parsed = parseRunRecord(record);
  return parsed.ok ? { ok: true, record: parsed.record, gaps: [] } : { ok: false, gaps: [], reason: parsed.error };
}

interface CallLog {
  modelCalls: ModelCall[] | null;
  toolCalls: ToolCall[] | null;
  documentCalls: DocumentCall[] | null;
  usage: RunUsage | null;
}

/**
 * Reads the graph's own call log out of thread state.
 *
 * Each array is read independently and a malformed one comes back null rather
 * than empty, so a graph that reports two of the three gets two filled and one
 * named -- not three claimed.
 */
export function readCallLog(state: unknown): CallLog {
  const values = asRecord(asRecord(state)?.values) ?? asRecord(state);
  const log = asRecord(values?.[CALL_LOG_STATE_KEY]);
  if (!log) return { modelCalls: null, toolCalls: null, documentCalls: null, usage: null };
  return {
    modelCalls: parseArray(log.modelCalls, (raw) => modelCallSchema.safeParse(raw)),
    toolCalls: parseArray(log.toolCalls, (raw) => toolCallSchema.safeParse(raw)),
    documentCalls: parseArray(log.documentCalls, (raw) => documentCallSchema.safeParse(raw)),
    usage: (() => {
      const parsed = runUsageSchema.safeParse(log.usage);
      return parsed.success ? parsed.data : null;
    })(),
  };
}

function parseArray<T>(raw: unknown, parse: (raw: unknown) => { success: true; data: T } | { success: false }): T[] | null {
  if (!Array.isArray(raw)) return null;
  const out: T[] = [];
  for (const item of raw) {
    const parsed = parse(item);
    if (!parsed.success) return null;
    out.push(parsed.data);
  }
  return out;
}

function lastNodeFromLog(
  modelCalls: readonly ModelCall[],
  toolCalls: readonly ToolCall[],
  documentCalls: readonly DocumentCall[],
): string | null {
  const failed = modelCalls.find((call) => call.status !== "success");
  if (failed) return failed.nodeId;
  const last = documentCalls.at(-1) ?? toolCalls.at(-1) ?? modelCalls.at(-1);
  return last?.nodeId ?? null;
}

function errorFromMetadata(metadata: Record<string, unknown>): string | null {
  const error = asRecord(metadata.error);
  return error ? firstString(error, ["message"]) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}
