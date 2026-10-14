import {
  DEFAULT_HOST_TIMEOUT_MS,
  appendThreadMessage,
  expireRequest,
  listThreads,
  readThread,
  resumeValueOf,
  threadStatus,
  type NewThreadMessage,
} from "@patchbay/core";
import type { LangGraphPort, WaitRunResult } from "./langgraphAdapter.js";

/**
 * 대화 칸의 실행 — 사람의 말을 LangGraph 스레드에 넣고, 노드가 `interrupt()`로 멈추면 그 요청을
 * 대화 파일에 남기고, 호스트의 답(또는 시간 초과)이 오면 같은 `thread_id`로 재개한다.
 *
 * Patchbay는 여기서도 모델을 부르지 않는다 (원칙 5 · 9). 실행은 LangGraph, 답은 IDE의 호스트 모델.
 * 이 모듈은 둘 사이의 기록과 중계만 한다.
 */

export type ThreadActionResult =
  | { ok: true; threadId: string; status: ReturnType<typeof threadStatus> }
  | { ok: false; status: 400 | 404 | 409 | 503; error: string };

const NOT_CONNECTED = "LangGraph가 연결돼 있지 않다 — 그래프가 있는 레포에서 `langgraph dev` 를 켠다.";

/** 같은 대화를 두 번 동시에 재개하지 않게 — 파일 감시와 시한 점검이 겹칠 수 있다. */
const resuming = new Set<string>();

interface InterruptFound {
  nodeId: string | null;
  value: unknown;
}

/**
 * `GET /threads/{id}/state` 에서 멈춘 노드를 찾는다. LangGraph 서버는 `tasks[].interrupts[]` 에
 * 싣고, 판에 따라 맨 위 `interrupts` 에도 싣는다 — 둘 다 본다.
 */
export function findInterrupt(state: unknown): InterruptFound | null {
  if (!state || typeof state !== "object") return null;
  const rec = state as Record<string, unknown>;
  const tasks = Array.isArray(rec.tasks) ? rec.tasks : [];
  for (const task of tasks) {
    if (!task || typeof task !== "object") continue;
    const t = task as Record<string, unknown>;
    const interrupts = Array.isArray(t.interrupts) ? t.interrupts : [];
    const first = interrupts[0];
    if (first && typeof first === "object") {
      return { nodeId: typeof t.name === "string" ? t.name : null, value: (first as Record<string, unknown>).value };
    }
  }
  const top = rec.interrupts;
  if (Array.isArray(top)) {
    const first = top[0];
    if (first && typeof first === "object") return { nodeId: null, value: (first as Record<string, unknown>).value };
  }
  if (top && typeof top === "object" && !Array.isArray(top)) {
    for (const list of Object.values(top)) {
      const first = Array.isArray(list) ? list[0] : null;
      if (first && typeof first === "object") return { nodeId: null, value: (first as Record<string, unknown>).value };
    }
  }
  return null;
}

/** 끝난 실행이 사람에게 보일 말 — 마지막 AI 메시지, 없으면 `summary`, 없으면 값 전체. */
export function finalText(values: unknown): string {
  if (!values || typeof values !== "object") return "";
  const rec = values as Record<string, unknown>;
  const messages = Array.isArray(rec.messages) ? rec.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as Record<string, unknown> | null;
    if (!m) continue;
    const kind = m.type ?? m.role;
    if (kind !== "ai" && kind !== "assistant") continue;
    if (typeof m.content === "string" && m.content.trim()) return m.content;
    if (Array.isArray(m.content)) {
      const text = m.content
        .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : ""))
        .join("");
      if (text.trim()) return text;
    }
  }
  if (typeof rec.summary === "string" && rec.summary.trim()) return rec.summary;
  return JSON.stringify(values);
}

function deadlineOf(value: unknown, now: Date): string {
  const ms =
    value && typeof value === "object" && typeof (value as Record<string, unknown>).timeoutMs === "number"
      ? ((value as Record<string, unknown>).timeoutMs as number)
      : DEFAULT_HOST_TIMEOUT_MS;
  return new Date(now.getTime() + ms).toISOString();
}

/** 가장 늦게 만든 실행. LangGraph dev 서버는 목록을 오래된 순으로 준다 — 순서를 믿지 않고 시각으로 고른다. */
async function latestRunId(port: LangGraphPort, threadId: string): Promise<string | undefined> {
  let best: { id: string; at: string } | undefined;
  for (const run of (await port.listRuns(threadId)) ?? []) {
    if (!run || typeof run !== "object") continue;
    const rec = run as Record<string, unknown>;
    if (typeof rec.run_id !== "string") continue;
    const at = typeof rec.created_at === "string" ? rec.created_at : "";
    if (!best || at > best.at) best = { id: rec.run_id, at };
  }
  return best?.id;
}

/** 실행 하나가 끝난 뒤 — 멈췄으면 `waiting`, 끝났으면 `success`, 아니면 `error` 를 붙인다. */
async function recordOutcome(
  studioHome: string,
  port: LangGraphPort,
  alias: string,
  threadId: string,
  assistantId: string,
  result: WaitRunResult,
  now: () => Date,
): Promise<void> {
  const runId = await latestRunId(port, threadId);
  const common = { role: "graph" as const, assistantId, ...(runId ? { runId } : {}) };
  let message: NewThreadMessage;
  if (result.status === "timeout") {
    message = { ...common, status: "error", text: "LangGraph 실행이 시간 안에 끝나지 않았다." };
  } else if (result.status === "error") {
    message = { ...common, status: "error", text: result.error };
  } else {
    const state = await port.getState(threadId);
    const found = findInterrupt(state);
    if (found) {
      message = {
        ...common,
        status: "waiting",
        ...(found.nodeId ? { nodeId: found.nodeId } : {}),
        request: found.value ?? null,
        deadlineAt: deadlineOf(found.value, now()),
      };
    } else {
      const values = state && typeof state === "object" ? (state as Record<string, unknown>).values : result.body;
      message = { ...common, status: "success", text: finalText(values ?? result.body) };
    }
  }
  await appendThreadMessage(studioHome, alias, threadId, message, now());
}

export async function sendThreadMessage(
  studioHome: string,
  port: LangGraphPort | undefined,
  input: { alias: string; threadId?: string; assistantId: string; text: string },
  now: () => Date = () => new Date(),
): Promise<ThreadActionResult> {
  if (!input.text.trim()) return { ok: false, status: 400, error: "보낼 말이 비어 있다." };
  if (!input.assistantId) return { ok: false, status: 400, error: "어느 그래프로 보낼지(assistantId)가 없다." };
  if (!port || !(await port.probe())) return { ok: false, status: 503, error: NOT_CONNECTED };

  let threadId = input.threadId;
  if (threadId) {
    const read = await readThread(studioHome, input.alias, threadId);
    const status = read ? threadStatus(read.messages) : "empty";
    if (status === "waiting" || status === "resuming") {
      return { ok: false, status: 409, error: "이 대화는 호스트의 답을 기다리는 중이다 — 답이 오거나 시간이 지나면 이어진다." };
    }
  } else {
    const assistants = await port.listAssistants();
    const graphId = assistants?.find((a) => a.id === input.assistantId)?.graphId ?? null;
    threadId = (await port.createThread(graphId)) ?? undefined;
    if (!threadId) return { ok: false, status: 503, error: "LangGraph에 새 대화(thread)를 만들지 못했다." };
  }

  await appendThreadMessage(studioHome, input.alias, threadId, { role: "user", text: input.text }, now());
  const result = await port.waitRun({
    threadId,
    assistantId: input.assistantId,
    input: { messages: [{ role: "user", content: input.text }] },
  });
  await recordOutcome(studioHome, port, input.alias, threadId, input.assistantId, result, now);
  const read = await readThread(studioHome, input.alias, threadId);
  return { ok: true, threadId, status: threadStatus(read?.messages ?? []) };
}

/** 답(또는 시간 초과)이 붙은 대화를 같은 `thread_id`로 재개한다. 재개할 것이 없으면 그대로 둔다. */
export async function resumeThread(
  studioHome: string,
  port: LangGraphPort | undefined,
  alias: string,
  threadId: string,
  now: () => Date = () => new Date(),
): Promise<ThreadActionResult> {
  const read = await readThread(studioHome, alias, threadId);
  if (!read) return { ok: false, status: 404, error: `대화 ${threadId} 가 없다.` };
  if (threadStatus(read.messages) !== "resuming") return { ok: true, threadId, status: threadStatus(read.messages) };
  if (!port || !(await port.probe())) return { ok: false, status: 503, error: NOT_CONNECTED };
  const value = resumeValueOf(read.messages);
  const waiting = [...read.messages].reverse().find((m) => m.role === "graph");
  if (!value || !waiting || waiting.role !== "graph") return { ok: false, status: 409, error: "재개할 요청을 찾지 못했다." };

  const key = `${alias}/${threadId}`;
  if (resuming.has(key)) return { ok: true, threadId, status: "resuming" };
  resuming.add(key);
  try {
    const result = await port.waitRun({ threadId, assistantId: waiting.assistantId, input: null, command: { resume: value } });
    await recordOutcome(studioHome, port, alias, threadId, waiting.assistantId, result, now);
  } finally {
    resuming.delete(key);
  }
  const after = await readThread(studioHome, alias, threadId);
  return { ok: true, threadId, status: threadStatus(after?.messages ?? []) };
}

/** 이 프로젝트의 대화 중 답이 붙은 것을 재개한다 — 파일 감시가 부른다. */
export async function resumeReady(studioHome: string, port: LangGraphPort | undefined, alias: string): Promise<void> {
  for (const summary of await listThreads(studioHome, alias)) {
    if (summary.status === "resuming") await resumeThread(studioHome, port, alias, summary.threadId);
  }
}

/** 한도가 지난 요청을 시간 초과로 닫고 재개한다 — 콘솔이 떠 있는 동안 주기적으로 (원칙 15). */
export async function expireOverdue(
  studioHome: string,
  port: LangGraphPort | undefined,
  alias: string,
  now: () => Date = () => new Date(),
): Promise<number> {
  let closed = 0;
  for (const summary of await listThreads(studioHome, alias)) {
    if (summary.status !== "waiting") continue;
    if (await expireRequest(studioHome, alias, summary.threadId, now())) {
      closed += 1;
      await resumeThread(studioHome, port, alias, summary.threadId, now);
    }
  }
  return closed;
}
